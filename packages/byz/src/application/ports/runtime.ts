export interface Disposable {
	dispose(): void;
}

export type NotificationLevel = "info" | "warning" | "error";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelReference {
	provider: string;
	id: string;
}

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
	find(provider: string, modelId: string): ModelReference | undefined;
	hasConfiguredAuth(model: ModelReference): boolean;
}

export interface BaseFeatureContext {
	ui: NotifyUiPort;
}

export interface DiagnosticsContext extends BaseFeatureContext {
	model: ModelReference | undefined;
}

export interface FastContext extends BaseFeatureContext {
	readonly model: ModelReference | undefined;
	modelRegistry: ModelRegistryPort;
	isIdle(): boolean;
}

export interface PrewalkContext extends BaseFeatureContext {
	cwd: string;
	isIdle(): boolean;
	isProjectTrusted(): boolean;
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
	model: ModelReference | undefined;
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
export type WorkflowPort = EventPort<WorkflowContext> & CommandRegistrationPort<WorkflowContext>;
export type ConversationPort = EventPort<ConversationContext> & CommandRegistrationPort<ConversationContext>;

export interface FastPort extends EventPort<FastContext>, CommandRegistrationPort<FastContext> {
	getThinkingLevel(): ThinkingLevel;
	setModel(model: ModelReference): Promise<boolean>;
	setThinkingLevel(level: ThinkingLevel): void;
}

export interface PrewalkPort extends EventPort<PrewalkContext>, CommandRegistrationPort<PrewalkContext> {
	getAllTools(): ToolDescriptor[];
}

export interface PiFeaturePorts {
	diagnostics: DiagnosticsPort;
	workflow: WorkflowPort;
	fast: FastPort;
	prewalk: PrewalkPort;
	conversation: ConversationPort;
}

export interface RuntimeProductProfile {
	showStartupHeader?: boolean;
	showLoadedResources?: boolean;
}

export interface RuntimeLaunchPort<TOptions extends object> {
	run(args: string[], options?: TOptions): Promise<void>;
}
