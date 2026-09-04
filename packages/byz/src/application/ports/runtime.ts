export interface Disposable {
	dispose(): void;
}

export type NotificationLevel = "info" | "warning" | "error";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelIdentity {
	readonly provider: string;
	readonly id: string;
}

export interface ModelHandle extends ModelIdentity {}

export interface ToolDescriptor {
	name: string;
	sourceInfo?: {
		source?: string;
		path?: string;
	};
}

export interface NotifyUiPort {
	notify(message: string, level?: NotificationLevel): void;
}

export interface ConversationUiPort extends NotifyUiPort {
	input(prompt: string, title?: string): Promise<string | undefined>;
	setConfirmationPresenter(presenter: (request: unknown) => Promise<boolean>): void;
	setFooter(factory: (tui: unknown, theme: unknown, footerData: unknown) => unknown): void;
	setMessagePresenter(presenter: (message: unknown) => unknown): void;
	setTitle(title: string): void;
	setToolExecutionVisible(visible: boolean): void;
	setWorkingMessage(message?: string): void;
}

export interface ModelRegistryPort {
	find(provider: string, modelId: string): ModelHandle | undefined;
	hasConfiguredAuth(model: ModelHandle): boolean;
}

export interface BaseFeatureContext {
	ui: NotifyUiPort;
}

export interface DiagnosticsContext extends BaseFeatureContext {
	model: ModelHandle | undefined;
}

export interface FastContext extends BaseFeatureContext {
	readonly model: ModelHandle | undefined;
	modelRegistry: ModelRegistryPort;
	isIdle(): boolean;
}

export interface PrewalkContext extends BaseFeatureContext {
	cwd: string;
	isIdle(): boolean;
	isProjectTrusted(): boolean;
}

export interface PauseContext extends BaseFeatureContext {
	readonly signal: AbortSignal | undefined;
	isIdle(): boolean;
	readPauseEntries(): readonly unknown[];
}

export interface DeliveryContext extends BaseFeatureContext {
	cwd: string;
	isIdle(): boolean;
	isProjectTrusted(): boolean;
	input(prompt: string, title?: string): Promise<string | undefined>;
	readDeliveryScopeEntries(): readonly unknown[];
}

export type RecoverySessionStartReason = "startup" | "reload" | "new" | "resume" | "fork";

export interface RecoveryContext extends BaseFeatureContext {
	cwd: string;
	reason: RecoverySessionStartReason | undefined;
	isProjectTrusted(): boolean;
	readSessionSummary(): { hasHistory: boolean } | undefined;
}

export interface ManagedResourcePort {
	replace(resources: { promptPaths?: string[]; skillPaths?: string[] }): Promise<void>;
}

export interface WorkflowContext extends BaseFeatureContext {
	isIdle(): boolean;
	replaceManagedResources(resources: { promptPaths?: string[]; skillPaths?: string[] }): Promise<void>;
}

export interface ConversationContext {
	cwd: string;
	model: ModelHandle | undefined;
	thinkingLevel?: ThinkingLevel;
	ui: ConversationUiPort;
	sessionManager: {
		getCwd(): string;
		getEntries(): readonly unknown[];
	};
	getContextUsage(): { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
}

export interface ByzEvent {
	type: string;
	[key: string]: unknown;
}

export interface EventPort<TContext> {
	on(event: string, handler: (event: ByzEvent, context: TContext) => unknown | Promise<unknown>): Disposable;
}

export interface CommandDefinition<TContext> {
	description?: string;
	handler(args: string, context: TContext): Promise<void>;
}

export interface CommandRegistrationPort<TContext> {
	registerCommand(name: string, command: CommandDefinition<TContext>): void;
}

export type DiagnosticsPort = EventPort<DiagnosticsContext>;
export type RecoveryPort = EventPort<RecoveryContext> & CommandRegistrationPort<RecoveryContext>;
export type WorkflowPort = EventPort<WorkflowContext> & CommandRegistrationPort<WorkflowContext>;
export type ConversationPort = EventPort<ConversationContext> & CommandRegistrationPort<ConversationContext>;
export type PausePort = EventPort<PauseContext> &
	CommandRegistrationPort<PauseContext> & {
		appendEntry(entry: unknown): void;
	};
export interface DeliveryProcessResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

export type DeliveryPort = EventPort<DeliveryContext> &
	CommandRegistrationPort<DeliveryContext> & {
		appendResult(entry: unknown): void;
		appendScope(entry: unknown): void;
		exec(
			program: "git" | "gh",
			args: string[],
			options: { cwd: string; timeoutMs: number },
		): Promise<DeliveryProcessResult>;
	};

export interface ExecutionContext {
	readEntries(): readonly unknown[];
}

export interface ExecutionToolResult {
	accepted: boolean;
	errorCode?: string;
	planId?: string;
	counts?: Readonly<Record<string, number>>;
}

export interface ExecutionPort extends EventPort<ExecutionContext> {
	registerTool(execute: (input: unknown) => ExecutionToolResult | Promise<ExecutionToolResult>): void;
	appendEntry(entry: unknown): void;
}

export interface FastPort extends EventPort<FastContext>, CommandRegistrationPort<FastContext> {
	getThinkingLevel(): ThinkingLevel;
	setModel(model: ModelHandle): Promise<boolean>;
	setThinkingLevel(level: ThinkingLevel): void;
}

export interface PrewalkPort extends EventPort<PrewalkContext>, CommandRegistrationPort<PrewalkContext> {
	getAllTools(): ToolDescriptor[];
}

export interface PiFeaturePorts {
	diagnostics: DiagnosticsPort;
	recovery: RecoveryPort;
	workflow: WorkflowPort;
	fast: FastPort;
	prewalk: PrewalkPort;
	conversation: ConversationPort;
	execution: ExecutionPort;
	pause: PausePort;
	delivery: DeliveryPort;
}

export interface RuntimeProductProfile {
	showStartupHeader?: boolean;
	showLoadedResources?: boolean;
}

export type CommandRuntime = "none" | "pi" | "interactive";

export interface CommandResult {
	status: "handled" | "passthrough";
	exitCode: number;
	stdout: string[];
	stderr: string[];
}

export interface ByzCommand<TInput = unknown, TContext = unknown> {
	id: string;
	parse(args: readonly string[]): TInput | undefined;
	execute(input: TInput, context: TContext): Promise<CommandResult>;
	runtime: CommandRuntime;
}

export interface RuntimeLaunchPort<TOptions extends object> {
	run(args: string[], options?: TOptions): Promise<void>;
}
