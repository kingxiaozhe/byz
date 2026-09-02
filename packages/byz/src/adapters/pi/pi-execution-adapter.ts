import type {
	ByzEvent,
	Disposable,
	ExecutionContext,
	ExecutionPort,
	ExecutionToolResult,
} from "../../application/ports/runtime.ts";
import {
	EXECUTION_TOOL_PARAMETERS,
	isPlainRecord,
	projectExecutionData,
	projectExecutionStart,
	projectExecutionToolResult,
} from "./pi-execution-schema.ts";

const ENTRY_TYPE = "byz.execution.v1";
const EVENTS = new Set([
	"session_start",
	"session_before_compact",
	"session_before_switch",
	"tool_execution_start",
	"tool_execution_end",
	"agent_end",
	"session_shutdown",
]);

type PiContext = {
	sessionManager?: { getEntries?(): readonly unknown[] };
};

type PiRegisteredTool = {
	name: string;
	label: string;
	description: string;
	promptSnippet: string;
	promptGuidelines: string[];
	parameters: Record<string, unknown>;
	execute(
		toolCallId: string,
		input: unknown,
		signal: unknown,
		onUpdate: unknown,
		context: unknown,
	): Promise<{ content: Array<{ type: "text"; text: string }>; details: ExecutionToolResult }>;
};

type PiExecutionApi = {
	on(event: string, handler: (event: unknown, context: PiContext) => unknown | Promise<unknown>): void;
	registerTool?(tool: PiRegisteredTool): void;
	appendEntry?(customType: string, data?: unknown): void;
};

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function createContext(context: PiContext): ExecutionContext {
	return Object.freeze({
		readEntries() {
			const entries = context.sessionManager?.getEntries?.();
			if (!Array.isArray(entries)) return Object.freeze([Object.freeze({})]);
			return Object.freeze(
				entries.flatMap((value) => {
					const entry = asRecord(value);
					if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) return [];
					return [projectExecutionData(entry.data) ?? Object.freeze({})];
				}),
			);
		},
	});
}

function projectEvent(eventName: string, value: unknown): ByzEvent {
	const event = asRecord(value);
	if (eventName === "tool_execution_start") {
		return Object.freeze({
			type: eventName,
			toolCallId: event.toolCallId,
			...projectExecutionStart(event.toolName, event.args),
		});
	}
	if (eventName === "tool_execution_end") {
		return Object.freeze({
			type: eventName,
			toolCallId: event.toolCallId,
			outcome: event.isError === false ? "success" : "failure",
		});
	}
	return Object.freeze({ type: eventName });
}

function registerTool(
	pi: PiExecutionApi,
	execute: (input: unknown) => ExecutionToolResult | Promise<ExecutionToolResult>,
): void {
	if (!pi.registerTool) throw new Error("Pi execution tool capability is unavailable.");
	const parameters = projectExecutionData(EXECUTION_TOOL_PARAMETERS);
	if (!isPlainRecord(parameters)) throw new Error("BYZ execution tool schema is invalid.");
	pi.registerTool({
		name: "byz_execution",
		label: "BYZ Execution",
		description: "Create and update a closed structured execution plan. Use only for concrete runtime tasks.",
		promptSnippet: "Track concrete multi-step work with a sealed structured execution plan.",
		promptGuidelines: [
			"Use byz_execution for concrete multi-step work; open the complete task set, then seal it before starting tasks.",
			"Do not infer completion from prose. Record only explicit task transitions and declared evidence.",
		],
		parameters,
		async execute(_toolCallId, input) {
			let result: ExecutionToolResult;
			try {
				result = projectExecutionToolResult(await execute(input));
			} catch {
				result = Object.freeze({ accepted: false, errorCode: "invalid_record" });
			}
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	});
}

export function createPiExecutionPort(pi: PiExecutionApi): ExecutionPort {
	return Object.freeze({
		on(
			event: string,
			handler: (event: ByzEvent, context: ExecutionContext) => unknown | Promise<unknown>,
		): Disposable {
			if (!EVENTS.has(event)) throw new Error(`execution port does not allow event ${JSON.stringify(event)}.`);
			let active = true;
			pi.on(event, (rawEvent, rawContext) => {
				if (!active) return undefined;
				if (typeof rawContext !== "object" || rawContext === null) {
					throw new Error(`execution event ${JSON.stringify(event)} is missing its Pi context.`);
				}
				const toolName = asRecord(rawEvent).toolName;
				if ((event === "tool_execution_start" || event === "tool_execution_end") && toolName === "byz_execution") {
					return undefined;
				}
				return handler(projectEvent(event, rawEvent), createContext(rawContext));
			});
			return Object.freeze({
				dispose() {
					active = false;
				},
			});
		},
		registerTool(execute: (input: unknown) => ExecutionToolResult | Promise<ExecutionToolResult>) {
			registerTool(pi, execute);
		},
		appendEntry(entry: unknown) {
			if (!pi.appendEntry) throw new Error("Pi Session entry capability is unavailable.");
			const projected = projectExecutionData(entry);
			if (!isPlainRecord(projected)) throw new Error("BYZ execution entry is invalid.");
			pi.appendEntry(ENTRY_TYPE, projected);
		},
	});
}
