import type {
	ByzEvent,
	CommandDefinition,
	ConversationContext,
	DiagnosticsContext,
	Disposable,
	FastContext,
	ModelReference,
	NotificationLevel,
	PiFeaturePorts,
	PrewalkContext,
	RuntimeLaunchPort,
	RuntimeProductProfile,
	ThinkingLevel,
	ToolDescriptor,
	WorkflowContext,
} from "../../application/ports/runtime.ts";

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
const CONVERSATION_EVENTS = new Set([
	"session_start",
	"thinking_level_select",
	"agent_start",
	"tool_execution_start",
	"tool_execution_end",
	"message_update",
	"agent_end",
	"session_shutdown",
	"before_agent_start",
]);
const MODEL_REFERENCE_IDENTITIES = new WeakMap<ModelReference, { provider: string; id: string }>();

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

function createModelProjector(resolveCurrent: (provider: string, id: string) => PiModel | undefined) {
	const references = new WeakMap<PiModel, ModelReference>();
	const models = new WeakMap<ModelReference, PiModel>();

	return {
		project(model: PiModel | undefined): ModelReference | undefined {
			if (!model) return undefined;
			const existing = references.get(model);
			if (existing) return existing;
			const reference = Object.freeze({ provider: model.provider, id: model.id });
			references.set(model, reference);
			models.set(reference, model);
			MODEL_REFERENCE_IDENTITIES.set(reference, { provider: model.provider, id: model.id });
			return reference;
		},
		resolve(model: ModelReference): PiModel {
			const local = models.get(model);
			if (local) return local;
			const identity = MODEL_REFERENCE_IDENTITIES.get(model);
			const current = identity ? resolveCurrent(identity.provider, identity.id) : undefined;
			if (!current) throw new Error("Model reference was not created by the Pi adapter or is no longer available.");
			models.set(model, current);
			return current;
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
			hasConfiguredAuth(model: ModelReference) {
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
	eventName: string,
	value: unknown,
	modelProjector: ReturnType<typeof createModelProjector>,
): ByzEvent {
	const event = asRecord(value);
	switch (eventName) {
		case "resources_discover":
			return Object.freeze({ type: eventName, reason: event.reason });
		case "agent_end":
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
		case "tool_execution_start":
			return Object.freeze({
				type: eventName,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
			});
		case "tool_execution_end": {
			const args = asRecord(event.args);
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
		case "message_update":
			return Object.freeze({ type: eventName, message: { role: asRecord(event.message).role } });
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
			return handler(projectEvent(event, rawEvent, modelProjector), createContext(rawContext));
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

export function createPiExtensionPorts(pi: PiExtensionApiLike): PiFeaturePorts {
	let currentFastContext: PiContextLike | undefined;
	const modelProjector = createModelProjector((provider, id) => currentFastContext?.modelRegistry?.find(provider, id));
	const diagnosticsContext = (context: PiContextLike) => createDiagnosticsContext(context, modelProjector);
	const fastContext = (context: PiContextLike) => {
		currentFastContext = context;
		return createFastContext(context, modelProjector);
	};
	const prewalkContext = (context: PiContextLike) => createPrewalkContext(context);
	const conversationContext = (context: PiContextLike) => createConversationContext(context, modelProjector);

	const diagnostics = Object.freeze({
		on: createEventPort(pi, "diagnostics", DIAGNOSTICS_EVENTS, modelProjector, diagnosticsContext),
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
		setModel(model: ModelReference) {
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

	return Object.freeze({ diagnostics, workflow, fast, prewalk, conversation });
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
