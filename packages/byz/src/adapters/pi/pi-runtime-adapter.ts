import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
	ByzEvent,
	CommandDefinition,
	ConversationContext,
	DeliveryContext,
	DiagnosticsContext,
	Disposable,
	FastContext,
	ModelHandle,
	NotificationLevel,
	PauseContext,
	PiFeaturePorts,
	PrewalkContext,
	RecoveryContext,
	RecoverySessionStartReason,
	RuntimeLaunchPort,
	RuntimeProductProfile,
	ThinkingLevel,
	ToolDescriptor,
	WorkflowContext,
} from "../../application/ports/runtime.ts";
import { createPiExecutionPort } from "./pi-execution-adapter.ts";

const execFileAsync = promisify(execFile);
const DELIVERY_OUTPUT_LIMIT = 256 * 1024;
const DELIVERY_FORBIDDEN_ARGS = new Set(["-f", "--force", "--force-with-lease", "--no-verify", "--admin"]);

type ProductProfileOptions = { productProfile?: RuntimeProductProfile };
type PiHandler = (event: unknown, context: PiContextLike) => unknown | Promise<unknown>;

type PiModel = {
	provider: string;
	id: string;
};

type PiTool = {
	name: string;
	sourceInfo?: {
		source?: string;
		path?: string;
	};
};

interface PiUiLike {
	notify?(message: string, level?: NotificationLevel): void;
	input?(prompt: string, title?: string): Promise<string | undefined>;
	setConfirmationPresenter?(presenter: (request: unknown) => Promise<boolean>): void;
	setFooter?(factory: (tui: unknown, theme: unknown, footerData: unknown) => unknown): void;
	setMessagePresenter?(presenter: (message: unknown) => unknown): void;
	setTitle?(title: string): void;
	setToolExecutionVisible?(visible: boolean): void;
	setWorkingMessage?(message?: string): void;
}

interface PiModelRegistryLike {
	find(provider: string, modelId: string): PiModel | undefined;
	hasConfiguredAuth(model: PiModel): boolean;
}

interface PiSessionManagerLike {
	getCwd?(): string;
	getEntries?(): readonly unknown[];
}

interface PiContextLike {
	cwd?: string;
	model?: PiModel;
	thinkingLevel?: ThinkingLevel;
	modelRegistry?: PiModelRegistryLike;
	sessionManager?: PiSessionManagerLike;
	ui?: PiUiLike;
	getContextUsage?(): { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
	isIdle?(): boolean;
	isProjectTrusted?(): boolean;
	replaceManagedResources?(resources: { promptPaths?: string[]; skillPaths?: string[] }): Promise<void>;
	signal?: AbortSignal;
}

interface PiExtensionApiLike {
	on(event: string, handler: PiHandler): void;
	registerCommand(
		name: string,
		command: {
			description?: string;
			handler(args: string, context: PiContextLike): Promise<void>;
		},
	): void;
	getAllTools(): PiTool[];
	getThinkingLevel(): ThinkingLevel;
	setModel(model: PiModel): Promise<boolean>;
	setThinkingLevel(level: ThinkingLevel): void;
	appendEntry?(customType: string, data?: unknown): void;
}

const DIAGNOSTICS_EVENTS = new Set([
	"session_start",
	"agent_start",
	"agent_end",
	"before_provider_request",
	"after_provider_response",
	"tool_execution_start",
	"tool_execution_end",
	"session_shutdown",
]);
const WORKFLOW_EVENTS = new Set(["resources_discover"]);
const FAST_EVENTS = new Set(["model_select", "thinking_level_select", "session_start"]);
const PREWALK_EVENTS = new Set(["tool_result"]);
const DELIVERY_EVENTS = new Set(["session_start", "tool_execution_start", "tool_execution_end"]);
const PAUSE_EVENTS = new Set([
	"session_start",
	"agent_start",
	"agent_end",
	"agent_settled",
	"model_request_gate",
	"tool_batch_start",
	"tool_call",
	"tool_execution_start",
	"tool_execution_end",
	"session_shutdown",
]);
const RECOVERY_EVENTS = new Set(["session_start", "session_shutdown"]);
const RECOVERY_SESSION_START_REASONS = new Set<RecoverySessionStartReason>([
	"startup",
	"reload",
	"new",
	"resume",
	"fork",
]);
const CONVERSATION_EVENTS = new Set([
	"session_start",
	"thinking_level_select",
	"agent_start",
	"agent_settled",
	"tool_execution_start",
	"tool_execution_end",
	"message_update",
	"message_end",
	"agent_end",
	"session_shutdown",
	"before_agent_start",
]);
function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function projectUsage(value: unknown): Record<string, unknown> | undefined {
	const usage = asRecord(value);
	const projected: Record<string, unknown> = {};
	for (const field of ["input", "output", "cacheRead", "cacheWrite"]) {
		if (typeof usage[field] === "number") projected[field] = usage[field];
	}
	const cost = asRecord(usage.cost);
	if (typeof cost.total === "number") projected.cost = { total: cost.total };
	return Object.keys(projected).length > 0 ? projected : undefined;
}

const OBSERVED_USAGE_FIELDS = ["input", "output", "cacheRead", "cacheWrite"] as const;

type ObservedUsage = Partial<Record<(typeof OBSERVED_USAGE_FIELDS)[number], number>>;

function projectSafeUsage(value: unknown): ObservedUsage | undefined {
	const usage = asRecord(value);
	const projected: ObservedUsage = {};
	for (const field of OBSERVED_USAGE_FIELDS) {
		const count = usage[field];
		if (Number.isSafeInteger(count) && (count as number) >= 0) projected[field] = count as number;
	}
	return Object.keys(projected).length > 0 ? projected : undefined;
}

function projectObservedUsage(value: unknown): ObservedUsage | undefined {
	const projected = projectSafeUsage(value);
	const observed = OBSERVED_USAGE_FIELDS.some((field) => (projected?.[field] ?? 0) > 0);
	return observed && projected ? Object.freeze(projected) : undefined;
}

function aggregateObservedUsage(messages: unknown): ObservedUsage | undefined {
	if (!Array.isArray(messages)) return undefined;
	const totals: ObservedUsage = {};
	const invalid = new Set<(typeof OBSERVED_USAGE_FIELDS)[number]>();
	for (const value of messages) {
		const message = asRecord(value);
		if (message.role !== "assistant" && message.role !== "toolResult") continue;
		const usage = projectSafeUsage(message.usage);
		for (const field of OBSERVED_USAGE_FIELDS) {
			if (invalid.has(field) || usage?.[field] === undefined) continue;
			const total = (totals[field] ?? 0) + usage[field];
			if (!Number.isSafeInteger(total)) {
				delete totals[field];
				invalid.add(field);
			} else {
				totals[field] = total;
			}
		}
	}
	const observed = OBSERVED_USAGE_FIELDS.some((field) => (totals[field] ?? 0) > 0);
	return observed ? Object.freeze(totals) : undefined;
}

function projectSessionEntry(value: unknown): Record<string, unknown> {
	const entry = asRecord(value);
	const message = asRecord(entry.message);
	return {
		type: entry.type,
		message:
			Object.keys(message).length === 0
				? undefined
				: {
						role: message.role,
						usage: projectUsage(message.usage),
					},
		usage: projectUsage(entry.usage),
	};
}

function createNotifyUi(context: PiContextLike) {
	const ui = context.ui;
	return Object.freeze({
		notify(message: string, level?: NotificationLevel) {
			ui?.notify?.(message, level);
		},
	});
}

function projectFooterArguments(tuiValue: unknown, themeValue: unknown, footerDataValue: unknown) {
	const tui = asRecord(tuiValue);
	const theme = asRecord(themeValue);
	const footerData = asRecord(footerDataValue);
	return {
		tui: Object.freeze({
			requestRender() {
				if (typeof tui.requestRender === "function") Reflect.apply(tui.requestRender, tuiValue, []);
			},
		}),
		theme: Object.freeze({
			fg(color: string, text: string) {
				return typeof theme.fg === "function" ? Reflect.apply(theme.fg, themeValue, [color, text]) : text;
			},
		}),
		footerData: Object.freeze({
			onBranchChange(handler: () => void) {
				if (typeof footerData.onBranchChange !== "function") return undefined;
				const unsubscribe = Reflect.apply(footerData.onBranchChange, footerDataValue, [handler]);
				return typeof unsubscribe === "function" ? () => Reflect.apply(unsubscribe, undefined, []) : undefined;
			},
			getGitBranch() {
				if (typeof footerData.getGitBranch !== "function") return undefined;
				const branch = Reflect.apply(footerData.getGitBranch, footerDataValue, []);
				return typeof branch === "string" ? branch : undefined;
			},
			getExtensionStatuses() {
				if (typeof footerData.getExtensionStatuses !== "function") return new Map<string, string>();
				const statuses = Reflect.apply(footerData.getExtensionStatuses, footerDataValue, []);
				if (!(statuses instanceof Map)) return new Map<string, string>();
				return new Map(
					[...statuses.entries()].filter(
						(entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string",
					),
				);
			},
		}),
	};
}

function createConversationUi(context: PiContextLike) {
	const ui = context.ui;
	return Object.freeze({
		notify(message: string, level?: NotificationLevel) {
			ui?.notify?.(message, level);
		},
		input(prompt: string, title?: string) {
			return ui?.input?.(prompt, title) ?? Promise.resolve(undefined);
		},
		setConfirmationPresenter(presenter: (request: unknown) => Promise<boolean>) {
			ui?.setConfirmationPresenter?.((request) => {
				const source = asRecord(request);
				const confirm = source.confirm;
				return presenter(
					Object.freeze({
						title: typeof source.title === "string" ? source.title : "",
						message: typeof source.message === "string" ? source.message : "",
						confirm() {
							return typeof confirm === "function"
								? Reflect.apply(confirm, request, [])
								: Promise.resolve(false);
						},
					}),
				);
			});
		},
		setFooter(factory: (tui: unknown, theme: unknown, footerData: unknown) => unknown) {
			ui?.setFooter?.((tui, theme, footerData) => {
				const projected = projectFooterArguments(tui, theme, footerData);
				return factory(projected.tui, projected.theme, projected.footerData);
			});
		},
		setMessagePresenter(presenter: (message: unknown) => unknown) {
			ui?.setMessagePresenter?.(presenter);
		},
		setTitle(title: string) {
			ui?.setTitle?.(title);
		},
		setToolExecutionVisible(visible: boolean) {
			ui?.setToolExecutionVisible?.(visible);
		},
		setWorkingMessage(message?: string) {
			ui?.setWorkingMessage?.(message);
		},
	});
}

function createModelProjector() {
	const references = new WeakMap<PiModel, ModelHandle>();
	const models = new WeakMap<ModelHandle, PiModel>();

	return {
		project(model: PiModel | undefined): ModelHandle | undefined {
			if (!model) return undefined;
			const existing = references.get(model);
			if (existing) return existing;
			const handle = Object.freeze({ provider: model.provider, id: model.id });
			references.set(model, handle);
			models.set(handle, model);
			return handle;
		},
		resolve(handle: ModelHandle): PiModel {
			const model = models.get(handle);
			if (!model) throw new Error("Model handle was not created by the current Pi adapter lineage.");
			return model;
		},
	};
}

function createFastContext(
	context: PiContextLike,
	modelProjector: ReturnType<typeof createModelProjector>,
): FastContext {
	return Object.freeze({
		ui: createNotifyUi(context),
		get model() {
			return modelProjector.project(context.model);
		},
		modelRegistry: Object.freeze({
			find(provider: string, modelId: string) {
				return modelProjector.project(context.modelRegistry?.find(provider, modelId));
			},
			hasConfiguredAuth(model: ModelHandle) {
				return context.modelRegistry?.hasConfiguredAuth(modelProjector.resolve(model)) ?? false;
			},
		}),
		isIdle() {
			return context.isIdle?.() ?? false;
		},
	});
}

function createPrewalkContext(context: PiContextLike): PrewalkContext {
	if (typeof context.cwd !== "string" || context.cwd.length === 0) {
		throw new Error("Prewalk requires an event context with a working directory.");
	}
	return Object.freeze({
		ui: createNotifyUi(context),
		cwd: context.cwd,
		isIdle() {
			return context.isIdle?.() ?? false;
		},
		isProjectTrusted() {
			return context.isProjectTrusted?.() ?? false;
		},
	});
}

function createDeliveryContext(context: PiContextLike): DeliveryContext {
	return Object.freeze({
		cwd: context.cwd ?? process.cwd(),
		ui: createNotifyUi(context),
		input(prompt: string, title?: string) {
			return context.ui?.input?.(prompt, title) ?? Promise.resolve(undefined);
		},
		isIdle() {
			return context.isIdle?.() ?? false;
		},
		isProjectTrusted() {
			return context.isProjectTrusted?.() ?? false;
		},
		readDeliveryScopeEntries() {
			return Object.freeze(
				(context.sessionManager?.getEntries?.() ?? []).flatMap((value) => {
					const entry = asRecord(value);
					return entry.type === "custom" && entry.customType === "byz.delivery.scope.v1"
						? [Object.freeze(asRecord(entry.data))]
						: [];
				}),
			);
		},
	});
}

function createPauseContext(context: PiContextLike): PauseContext {
	return Object.freeze({
		signal: context.signal,
		ui: createNotifyUi(context),
		isIdle() {
			return context.isIdle?.() ?? false;
		},
		readPauseEntries() {
			return Object.freeze(
				(context.sessionManager?.getEntries?.() ?? []).flatMap((value) => {
					const entry = asRecord(value);
					return entry.type === "custom" && entry.customType === "byz.pause.v1"
						? [Object.freeze(asRecord(entry.data))]
						: [];
				}),
			);
		},
	});
}

function createRecoveryContext(
	context: PiContextLike,
	reason: RecoverySessionStartReason | undefined,
): RecoveryContext {
	const sessionManager = context.sessionManager;
	return Object.freeze({
		cwd: context.cwd ?? process.cwd(),
		reason,
		ui: createNotifyUi(context),
		isProjectTrusted() {
			return context.isProjectTrusted?.() ?? false;
		},
		readSessionSummary() {
			if (!(context.isProjectTrusted?.() ?? false)) return undefined;
			return { hasHistory: (sessionManager?.getEntries?.().length ?? 0) > 0 };
		},
	});
}

function createDiagnosticsContext(
	context: PiContextLike,
	modelProjector: ReturnType<typeof createModelProjector>,
): DiagnosticsContext {
	return Object.freeze({
		ui: createNotifyUi(context),
		model: modelProjector.project(context.model),
	});
}

function createWorkflowContext(context: PiContextLike): WorkflowContext {
	return Object.freeze({
		ui: createNotifyUi(context),
		isIdle() {
			return context.isIdle?.() ?? false;
		},
		replaceManagedResources(resources: { promptPaths?: string[]; skillPaths?: string[] }) {
			if (!context.replaceManagedResources) {
				return Promise.reject(new Error("Managed resource capability is unavailable."));
			}
			return context.replaceManagedResources(resources);
		},
	});
}

function createConversationContext(
	context: PiContextLike,
	modelProjector: ReturnType<typeof createModelProjector>,
): ConversationContext {
	const sessionManager = context.sessionManager;
	return Object.freeze({
		cwd: context.cwd ?? process.cwd(),
		model: modelProjector.project(context.model),
		thinkingLevel: context.thinkingLevel,
		ui: createConversationUi(context),
		sessionManager: Object.freeze({
			getCwd() {
				return sessionManager?.getCwd?.() ?? context.cwd ?? process.cwd();
			},
			getEntries() {
				return (sessionManager?.getEntries?.() ?? []).map(projectSessionEntry);
			},
		}),
		getContextUsage() {
			const usage = context.getContextUsage?.();
			return usage
				? { tokens: usage.tokens, contextWindow: usage.contextWindow, percent: usage.percent }
				: undefined;
		},
	});
}

function projectEvent(
	feature: string,
	eventName: string,
	value: unknown,
	modelProjector: ReturnType<typeof createModelProjector>,
): ByzEvent {
	const event = asRecord(value);
	switch (eventName) {
		case "session_start":
			return Object.freeze({ type: eventName, reason: event.reason });
		case "session_shutdown":
			return Object.freeze({ type: eventName, reason: event.reason });
		case "resources_discover":
			return Object.freeze({ type: eventName, reason: event.reason });
		case "agent_end":
			if (feature === "conversation") {
				return Object.freeze({ type: eventName, usage: aggregateObservedUsage(event.messages) });
			}
			return Object.freeze({
				type: eventName,
				messages: Array.isArray(event.messages)
					? event.messages.map((message) => {
							const projected = asRecord(message);
							return { role: projected.role, stopReason: projected.stopReason };
						})
					: [],
			});
		case "after_provider_response":
			return Object.freeze({ type: eventName, status: event.status });
		case "tool_execution_start": {
			const args = asRecord(event.args);
			return Object.freeze({
				type: eventName,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				...(feature === "delivery"
					? {
							path:
								typeof args.path === "string"
									? args.path
									: typeof args.file_path === "string"
										? args.file_path
										: undefined,
						}
					: {}),
			});
		}
		case "tool_execution_end": {
			if (feature === "pause") {
				return Object.freeze({
					type: eventName,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					isError: event.isError,
				});
			}
			const args = asRecord(event.args);
			if (feature === "delivery") {
				const path =
					typeof args.path === "string"
						? args.path
						: typeof args.file_path === "string"
							? args.file_path
							: undefined;
				return Object.freeze({
					type: eventName,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					outcome: event.isError === false ? "success" : event.isError === true ? "failure" : "unknown",
					path,
				});
			}
			const projectedArgs: Record<string, string> = {};
			for (const field of ["path", "file_path", "command"]) {
				if (typeof args[field] === "string") projectedArgs[field] = args[field];
			}
			return Object.freeze({
				type: eventName,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: Object.freeze(projectedArgs),
				isError: event.isError,
			});
		}
		case "tool_batch_start":
			return Object.freeze({
				type: eventName,
				toolCalls: Object.freeze(
					(Array.isArray(event.toolCalls) ? event.toolCalls : []).flatMap((value) => {
						const tool = asRecord(value);
						return typeof tool.toolCallId === "string" && typeof tool.toolName === "string"
							? [Object.freeze({ toolCallId: tool.toolCallId, toolName: tool.toolName })]
							: [];
					}),
				),
			});
		case "tool_call":
			return Object.freeze({ type: eventName, toolCallId: event.toolCallId, toolName: event.toolName });
		case "tool_result": {
			const input = asRecord(event.input);
			return Object.freeze({
				type: eventName,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				input: Object.freeze({ path: input.path }),
				isError: event.isError,
			});
		}
		case "model_select":
			return Object.freeze({
				type: eventName,
				model: modelProjector.project(event.model as PiModel | undefined),
				previousModel: modelProjector.project(event.previousModel as PiModel | undefined),
				source: event.source,
			});
		case "thinking_level_select":
			return Object.freeze({ type: eventName, level: event.level, previousLevel: event.previousLevel });
		case "message_update": {
			const message = asRecord(event.message);
			return Object.freeze({
				type: eventName,
				message: Object.freeze({ role: message.role, usage: projectObservedUsage(message.usage) }),
			});
		}
		case "message_end": {
			const message = asRecord(event.message);
			return Object.freeze({
				type: eventName,
				message: Object.freeze({ role: message.role, usage: projectObservedUsage(message.usage) }),
			});
		}
		case "before_agent_start":
			return Object.freeze({ type: eventName, prompt: event.prompt, systemPrompt: event.systemPrompt });
		default:
			return Object.freeze({ type: eventName });
	}
}

function createEventPort<TContext>(
	pi: PiExtensionApiLike,
	feature: string,
	allowedEvents: ReadonlySet<string>,
	modelProjector: ReturnType<typeof createModelProjector>,
	createContext: (context: PiContextLike) => TContext,
) {
	return function on(
		event: string,
		handler: (event: ByzEvent, context: TContext) => unknown | Promise<unknown>,
	): Disposable {
		if (!allowedEvents.has(event)) throw new Error(`${feature} port does not allow event ${JSON.stringify(event)}.`);
		let active = true;
		pi.on(event, (rawEvent, rawContext) => {
			if (!active) return undefined;
			if (typeof rawContext !== "object" || rawContext === null) {
				throw new Error(`${feature} event ${JSON.stringify(event)} is missing its Pi context.`);
			}
			return handler(projectEvent(feature, event, rawEvent, modelProjector), createContext(rawContext));
		});
		return Object.freeze({
			dispose() {
				active = false;
			},
		});
	};
}

function registerCommand<TContext>(
	pi: PiExtensionApiLike,
	feature: string,
	allowedCommands: ReadonlySet<string>,
	name: string,
	command: CommandDefinition<TContext>,
	createContext: (context: PiContextLike) => TContext,
): void {
	if (!allowedCommands.has(name)) throw new Error(`${feature} port does not allow command ${JSON.stringify(name)}.`);
	pi.registerCommand(name, {
		description: command.description,
		handler(args, rawContext) {
			return command.handler(args, createContext(rawContext));
		},
	});
}

function createRecoveryEventPort(pi: PiExtensionApiLike) {
	return function on(
		event: string,
		handler: (event: ByzEvent, context: RecoveryContext) => unknown | Promise<unknown>,
	): Disposable {
		if (!RECOVERY_EVENTS.has(event)) throw new Error(`recovery port does not allow event ${JSON.stringify(event)}.`);
		let active = true;
		pi.on(event, (rawEvent, rawContext) => {
			if (!active) return undefined;
			if (typeof rawContext !== "object" || rawContext === null) {
				throw new Error(`recovery event ${JSON.stringify(event)} is missing its Pi context.`);
			}
			if (!(rawContext.isProjectTrusted?.() ?? false)) return undefined;
			const rawReason = asRecord(rawEvent).reason;
			const reason =
				event === "session_start" && RECOVERY_SESSION_START_REASONS.has(rawReason as RecoverySessionStartReason)
					? (rawReason as RecoverySessionStartReason)
					: undefined;
			if (event === "session_start" && reason === undefined) {
				throw new Error("Recovery session_start event has an unsupported reason.");
			}
			return handler(
				Object.freeze({ type: event, ...(reason ? { reason } : {}) }),
				createRecoveryContext(rawContext, reason),
			);
		});
		return Object.freeze({
			dispose() {
				active = false;
			},
		});
	};
}

function registerRecoveryCommand(
	pi: PiExtensionApiLike,
	name: string,
	command: CommandDefinition<RecoveryContext>,
): void {
	if (name !== "project") throw new Error(`recovery port does not allow command ${JSON.stringify(name)}.`);
	pi.registerCommand(name, {
		description: command.description,
		handler(args, rawContext) {
			if (!(rawContext.isProjectTrusted?.() ?? false)) return Promise.resolve();
			return command.handler(args, createRecoveryContext(rawContext, undefined));
		},
	});
}

function isAllowedDeliveryProcess(program: string, args: string[]): boolean {
	if (
		(program !== "git" && program !== "gh") ||
		args.length === 0 ||
		args.some(
			(arg) =>
				typeof arg !== "string" ||
				arg.length > 1024 ||
				/[\u0000\r\n]/.test(arg) ||
				DELIVERY_FORBIDDEN_ARGS.has(arg) ||
				arg.startsWith("--force=") ||
				arg.startsWith("+"),
		)
	) {
		return false;
	}
	const joined = args.join(" ");
	if (program === "git") {
		if (joined === "rev-parse --show-toplevel" || joined === "rev-parse HEAD") return true;
		if (joined === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") return true;
		if (args[0] === "rev-parse" && args.length === 2) {
			if (/^[0-9a-f]{40}\^$/.test(args[1])) return true;
			if (/^:[^\u0000\r\n]+$/.test(args[1])) return true;
			if (/^[0-9a-f]{40}:[^\u0000\r\n]+$/.test(args[1])) return true;
		}
		if (joined === "symbolic-ref --quiet --short HEAD") return true;
		if (joined === "status --porcelain=v1 -z --untracked-files=all") return true;
		if (joined === "remote get-url origin") return true;
		if (/^ls-remote --heads origin refs\/heads\/[A-Za-z0-9._/-]+$/.test(joined)) return true;
		if (args[0] === "add" && args[1] === "--" && args.length > 2) return true;
		if (joined === "diff --cached --name-only -z") return true;
		if (args[0] === "hash-object" && args[1] === "--" && args.length === 3) return true;
		if (
			args[0] === "commit" &&
			args[1] === "--only" &&
			args[2] === "-m" &&
			args.length > 5 &&
			args[4] === "--" &&
			args[3].length > 0 &&
			args[3].length <= 120
		)
			return true;
		if (/^diff-tree --no-commit-id --name-only -r -z [0-9a-f]{40}$/.test(joined)) return true;
		if (
			args[0] === "push" &&
			args.length === 3 &&
			args[1] === "origin" &&
			/^([A-Za-z0-9][A-Za-z0-9._/-]*):\1$/.test(args[2])
		)
			return true;
		return false;
	}
	if (joined === "auth status --hostname github.com" || joined === "repo view --json nameWithOwner") return true;
	if (
		/^api repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/branches\/[A-Za-z0-9._/-]+\/protection\/required_status_checks$/.test(
			joined,
		) ||
		/^api repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/commits\/[0-9a-f]{40}\/check-runs$/.test(joined)
	)
		return true;
	if (args[0] !== "pr") return false;
	const safeRepository = (value: string) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
	if (args[1] === "create") {
		return (
			args.length === 13 &&
			args[2] === "--repo" &&
			safeRepository(args[3]) &&
			args[4] === "--draft" &&
			args[5] === "--base" &&
			/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(args[6]) &&
			args[7] === "--head" &&
			/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(args[8]) &&
			args[9] === "--title" &&
			args[10].length > 0 &&
			args[10].length <= 120 &&
			args[11] === "--body-file" &&
			/(?:^|[/\\])byz-delivery-pr-[^/\\]+[/\\]body\.md$/.test(args[12])
		);
	}
	if (args[1] === "view") {
		return (
			(args.length === 6 &&
				args[2] === "--repo" &&
				safeRepository(args[3]) &&
				args[4] === "--json" &&
				[
					"number,headRefOid,baseRefOid,baseRefName,mergeable,statusCheckRollup,state",
					"number,url,headRefOid,baseRefName,isDraft",
				].includes(args[5])) ||
			(args.length === 7 &&
				/^\d+$/.test(args[2]) &&
				args[3] === "--repo" &&
				safeRepository(args[4]) &&
				args[5] === "--json" &&
				args[6] === "state,mergedAt")
		);
	}
	return (
		args[1] === "merge" &&
		args.length === 6 &&
		/^\d+$/.test(args[2]) &&
		args[3] === "--repo" &&
		safeRepository(args[4]) &&
		args[5] === "--squash"
	);
}

async function executeDeliveryProcess(
	program: "git" | "gh",
	args: string[],
	options: { cwd: string; timeoutMs: number },
) {
	if (
		!isAllowedDeliveryProcess(program, args) ||
		!Number.isSafeInteger(options.timeoutMs) ||
		options.timeoutMs < 1 ||
		options.timeoutMs > 60_000
	) {
		throw new Error("Delivery process request is not allowlisted.");
	}
	const env = Object.fromEntries(
		["PATH", "HOME", "XDG_CONFIG_HOME", "GH_HOST", "GH_TOKEN", "GITHUB_TOKEN", "SSH_AUTH_SOCK"].flatMap((key) =>
			typeof process.env[key] === "string" ? [[key, process.env[key]]] : [],
		),
	);
	try {
		const result = await execFileAsync(program, args, {
			cwd: options.cwd,
			encoding: "utf8",
			env,
			maxBuffer: DELIVERY_OUTPUT_LIMIT,
			timeout: options.timeoutMs,
		});
		return Object.freeze({ exitCode: 0, stderr: result.stderr, stdout: result.stdout, timedOut: false });
	} catch (error) {
		const failure = error as { code?: unknown; killed?: boolean; stderr?: unknown; stdout?: unknown };
		return Object.freeze({
			exitCode: Number.isSafeInteger(failure.code) ? (failure.code as number) : 1,
			stderr: typeof failure.stderr === "string" ? failure.stderr.slice(0, DELIVERY_OUTPUT_LIMIT) : "",
			stdout: typeof failure.stdout === "string" ? failure.stdout.slice(0, DELIVERY_OUTPUT_LIMIT) : "",
			timedOut: failure.killed === true,
		});
	}
}

export function createPiExtensionPorts(pi: PiExtensionApiLike): PiFeaturePorts {
	const modelProjector = createModelProjector();
	const diagnosticsContext = (context: PiContextLike) => createDiagnosticsContext(context, modelProjector);
	const fastContext = (context: PiContextLike) => createFastContext(context, modelProjector);
	const prewalkContext = (context: PiContextLike) => createPrewalkContext(context);
	const conversationContext = (context: PiContextLike) => createConversationContext(context, modelProjector);
	const pauseContext = (context: PiContextLike) => createPauseContext(context);
	const deliveryContext = (context: PiContextLike) => createDeliveryContext(context);

	const diagnostics = Object.freeze({
		on: createEventPort(pi, "diagnostics", DIAGNOSTICS_EVENTS, modelProjector, diagnosticsContext),
	});
	const recovery = Object.freeze({
		on: createRecoveryEventPort(pi),
		registerCommand(name: string, command: CommandDefinition<RecoveryContext>) {
			registerRecoveryCommand(pi, name, command);
		},
	});
	const workflow = Object.freeze({
		on: createEventPort(pi, "workflow", WORKFLOW_EVENTS, modelProjector, createWorkflowContext),
		registerCommand(name: string, command: CommandDefinition<WorkflowContext>) {
			registerCommand(pi, "workflow", new Set(["workflow"]), name, command, createWorkflowContext);
		},
	});
	const fast = Object.freeze({
		on: createEventPort(pi, "fast", FAST_EVENTS, modelProjector, fastContext),
		registerCommand(name: string, command: CommandDefinition<FastContext>) {
			registerCommand(pi, "fast", new Set(["fast"]), name, command, fastContext);
		},
		getThinkingLevel() {
			return pi.getThinkingLevel();
		},
		async setModel(model: ModelHandle) {
			return pi.setModel(modelProjector.resolve(model));
		},
		setThinkingLevel(level: ThinkingLevel) {
			pi.setThinkingLevel(level);
		},
	});
	const prewalk = Object.freeze({
		on: createEventPort(pi, "prewalk", PREWALK_EVENTS, modelProjector, prewalkContext),
		registerCommand(name: string, command: CommandDefinition<PrewalkContext>) {
			registerCommand(pi, "prewalk", new Set(["prewalk"]), name, command, prewalkContext);
		},
		getAllTools(): ToolDescriptor[] {
			return pi.getAllTools().map((tool) => ({
				name: tool.name,
				sourceInfo: tool.sourceInfo ? { source: tool.sourceInfo.source, path: tool.sourceInfo.path } : undefined,
			}));
		},
	});
	const conversation = Object.freeze({
		on: createEventPort(pi, "conversation", CONVERSATION_EVENTS, modelProjector, conversationContext),
		registerCommand(name: string, command: CommandDefinition<ConversationContext>) {
			registerCommand(pi, "conversation", new Set(["details", "language"]), name, command, conversationContext);
		},
	});
	const execution = createPiExecutionPort(pi);
	const delivery = Object.freeze({
		on: createEventPort(pi, "delivery", DELIVERY_EVENTS, modelProjector, deliveryContext),
		exec: executeDeliveryProcess,
		registerCommand(name: string, command: CommandDefinition<DeliveryContext>) {
			registerCommand(pi, "delivery", new Set(["deliver"]), name, command, deliveryContext);
		},
		appendScope(entryValue: unknown) {
			if (!pi.appendEntry) throw new Error("Pi Session entry capability is unavailable.");
			const entry = asRecord(entryValue);
			if (
				entry.schemaVersion !== 1 ||
				!Number.isSafeInteger(entry.sequence) ||
				(entry.sequence as number) < 1 ||
				(entry.sequence as number) > 128 ||
				!Number.isSafeInteger(entry.generation) ||
				(entry.generation as number) < 1 ||
				typeof entry.path !== "string" ||
				entry.path.startsWith("/") ||
				entry.path.length > 512 ||
				/[\u0000-\u001f\u007f]/.test(entry.path) ||
				!/^[0-9a-f]{64}$/.test(String(entry.digest)) ||
				typeof entry.planId !== "string" ||
				typeof entry.taskId !== "string"
			) {
				throw new Error("BYZ delivery scope receipt is invalid.");
			}
			pi.appendEntry("byz.delivery.scope.v1", {
				schemaVersion: 1,
				digest: entry.digest,
				generation: entry.generation,
				path: entry.path,
				planId: entry.planId,
				sequence: entry.sequence,
				taskId: entry.taskId,
			});
		},
		appendResult(entryValue: unknown) {
			if (!pi.appendEntry) throw new Error("Pi Session entry capability is unavailable.");
			const entry = asRecord(entryValue);
			const actions = new Set(["commit", "push", "pr", "merge"]);
			const outcomes = new Set(["success", "failed", "partial", "cancelled", "stale"]);
			const sideEffects = new Set([
				"index_attempted",
				"index_changed",
				"commit",
				"remote_branch_observed",
				"push_attempted",
				"draft_pr_observed",
				"pr_create_attempted",
				"pr_merged",
				"merge_attempted",
				"cleanup_failed",
			]);
			if (
				!actions.has(entry.action as string) ||
				!outcomes.has(entry.outcome as string) ||
				(entry.preFingerprint !== undefined && !/^[0-9a-f]{64}$/.test(String(entry.preFingerprint))) ||
				(entry.postFingerprint !== undefined && !/^[0-9a-f]{64}$/.test(String(entry.postFingerprint))) ||
				(entry.generation !== undefined &&
					(!Number.isSafeInteger(entry.generation) || (entry.generation as number) < 1)) ||
				(entry.prNumber !== undefined &&
					(!Number.isSafeInteger(entry.prNumber) || (entry.prNumber as number) < 1)) ||
				(entry.sideEffects !== undefined &&
					(!Array.isArray(entry.sideEffects) ||
						entry.sideEffects.length > 16 ||
						new Set(entry.sideEffects).size !== entry.sideEffects.length ||
						entry.sideEffects.some((value) => !sideEffects.has(value))))
			) {
				throw new Error("BYZ delivery result receipt is invalid.");
			}
			pi.appendEntry("byz.delivery.v1", {
				schemaVersion: 1,
				action: entry.action,
				outcome: entry.outcome,
				...(Number.isSafeInteger(entry.generation) ? { generation: entry.generation } : {}),
				...(typeof entry.preFingerprint === "string" ? { preFingerprint: entry.preFingerprint } : {}),
				...(typeof entry.postFingerprint === "string" ? { postFingerprint: entry.postFingerprint } : {}),
				...(Array.isArray(entry.sideEffects) ? { sideEffects: entry.sideEffects } : {}),
				...(typeof entry.commitSha === "string" && /^[0-9a-f]{40}$/.test(entry.commitSha)
					? { commitSha: entry.commitSha }
					: {}),
				...(Number.isSafeInteger(entry.prNumber) ? { prNumber: entry.prNumber } : {}),
				...(typeof entry.remoteOid === "string" && /^[0-9a-f]{40}$/.test(entry.remoteOid)
					? { remoteOid: entry.remoteOid }
					: {}),
			});
		},
	});
	const pause = Object.freeze({
		on: createEventPort(pi, "pause", PAUSE_EVENTS, modelProjector, pauseContext),
		registerCommand(name: string, command: CommandDefinition<PauseContext>) {
			registerCommand(pi, "pause", new Set(["pause"]), name, command, pauseContext);
		},
		appendEntry(entryValue: unknown) {
			if (!pi.appendEntry) throw new Error("Pi Session entry capability is unavailable.");
			const entry = asRecord(entryValue);
			const states = new Set(["requested", "paused", "resuming", "running", "idle", "stale"]);
			const boundaries = new Set(["model", "tool"]);
			const durations = new Set(["<1s", "<10s", "<1m", ">=1m"]);
			const reasons = new Set(["registry_unavailable", "completed_before_pause", "cancelled", "shutdown", "reload"]);
			const validId = (value: unknown): value is string =>
				typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
			if (
				entry.schemaVersion !== 1 ||
				!Number.isSafeInteger(entry.generation) ||
				(entry.generation as number) < 0 ||
				!states.has(entry.state as string) ||
				!durations.has(entry.durationBucket as string) ||
				(entry.boundary !== undefined && !boundaries.has(entry.boundary as string)) ||
				(entry.reason !== undefined && !reasons.has(entry.reason as string)) ||
				(entry.planId !== undefined && !validId(entry.planId)) ||
				(entry.taskId !== undefined && !validId(entry.taskId))
			) {
				throw new Error("BYZ pause receipt is invalid.");
			}
			const projected = Object.freeze({
				schemaVersion: 1,
				generation: entry.generation,
				state: entry.state,
				durationBucket: entry.durationBucket,
				...(entry.boundary ? { boundary: entry.boundary } : {}),
				...(entry.planId ? { planId: entry.planId } : {}),
				...(entry.reason ? { reason: entry.reason } : {}),
				...(entry.taskId ? { taskId: entry.taskId } : {}),
			});
			pi.appendEntry("byz.pause.v1", projected);
		},
	});

	return Object.freeze({ diagnostics, recovery, workflow, fast, prewalk, conversation, execution, pause, delivery });
}

export function createPiRuntimeAdapter<TOptions extends ProductProfileOptions>(
	main: (args: string[], options?: TOptions) => Promise<void>,
	productProfile: RuntimeProductProfile,
): RuntimeLaunchPort<Omit<TOptions, "productProfile">> {
	return {
		run(args, options) {
			return main(args, { ...options, productProfile } as TOptions);
		},
	};
}
