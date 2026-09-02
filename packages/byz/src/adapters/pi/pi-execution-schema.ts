import type { ExecutionToolResult } from "../../application/ports/runtime.ts";

const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const ERROR_CODES = new Set([
	"active_task_exists",
	"invalid_action",
	"invalid_record",
	"invalid_transition",
	"limit_reached",
	"no_plan",
	"plan_not_sealed",
	"receipt_limit",
	"stale_plan",
	"tools_in_flight",
	"unknown_task",
	"unverified_receipt",
]);
const COUNT_FIELDS = [
	"blocked",
	"cancelled",
	"completed",
	"declaredEvidence",
	"observedEvidence",
	"verifiedEvidence",
] as const;
const COMMAND_TOOLS = new Set(["bash", "powershell", "shell"]);
const INSPECT_TOOLS = new Set(["read", "grep", "find", "glob", "ls", "web_fetch"]);
const MUTATION_TOOLS = new Set(["edit", "write", "delete", "patch", "mkdir"]);

export const EXECUTION_TOOL_PARAMETERS: Record<string, unknown> = {
	type: "object",
	additionalProperties: false,
	required: ["action"],
	properties: {
		action: { type: "string" },
		tasks: {
			type: "array",
			minItems: 1,
			maxItems: 64,
			items: {
				type: "object",
				additionalProperties: false,
				required: ["id"],
				properties: {
					id: { type: "string", pattern: ID_PATTERN.source },
					label: { type: "string", maxLength: 120 },
				},
			},
		},
		planId: { type: "string", pattern: ID_PATTERN.source },
		taskId: { type: "string", pattern: ID_PATTERN.source },
		outcome: { enum: ["completed", "blocked", "cancelled"] },
		kind: { type: "string", pattern: ID_PATTERN.source },
		basis: { enum: ["declared", "latest_observed"] },
	},
	oneOf: [
		{
			additionalProperties: false,
			required: ["action", "tasks"],
			properties: { action: { const: "plan_open" }, tasks: {} },
		},
		{
			additionalProperties: false,
			required: ["action", "planId"],
			properties: { action: { const: "plan_seal" }, planId: {} },
		},
		...(["task_start", "task_resume"] as const).map((action) => ({
			additionalProperties: false,
			required: ["action", "planId", "taskId"],
			properties: { action: { const: action }, planId: {}, taskId: {} },
		})),
		{
			additionalProperties: false,
			required: ["action", "planId", "taskId", "outcome"],
			properties: { action: { const: "task_finish" }, planId: {}, taskId: {}, outcome: {} },
		},
		{
			additionalProperties: false,
			required: ["action", "planId", "taskId", "kind", "basis"],
			properties: { action: { const: "evidence_add" }, planId: {}, taskId: {}, kind: {}, basis: {} },
		},
	],
};

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

export function projectExecutionData(
	value: unknown,
	budget = { characters: 0, nodes: 0, seen: new WeakSet<object>() },
	depth = 0,
): unknown {
	if (depth > 8 || budget.nodes >= 2048 || budget.characters > 16_384) return undefined;
	budget.nodes += 1;
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "number") return Number.isSafeInteger(value) ? value : undefined;
	if (typeof value === "string") {
		budget.characters += value.length;
		return budget.characters <= 16_384 ? value : undefined;
	}
	if (typeof value !== "object" || budget.seen.has(value)) return undefined;
	budget.seen.add(value);
	if (Array.isArray(value)) {
		if (value.length > 128) return undefined;
		const projected = value.map((item) => projectExecutionData(item, budget, depth + 1));
		return projected.includes(undefined) ? undefined : Object.freeze(projected);
	}
	if (!isPlainRecord(value)) return undefined;
	const keys = Object.keys(value);
	if (keys.length > 16 || keys.some((key) => key.length > 64)) return undefined;
	const projected: Record<string, unknown> = {};
	for (const key of keys) {
		const item = projectExecutionData(value[key], budget, depth + 1);
		if (item === undefined) return undefined;
		projected[key] = item;
	}
	return Object.freeze(projected);
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function projectExecutionToolResult(value: unknown): ExecutionToolResult {
	const result = asRecord(value);
	if (result.accepted !== true) {
		return Object.freeze({
			accepted: false,
			errorCode:
				typeof result.errorCode === "string" && ERROR_CODES.has(result.errorCode)
					? result.errorCode
					: "invalid_action",
		});
	}
	const projected: { accepted: true; planId?: string; counts?: Readonly<Record<string, number>> } = {
		accepted: true,
	};
	if (typeof result.planId === "string" && ID_PATTERN.test(result.planId)) projected.planId = result.planId;
	const counts = asRecord(result.counts);
	const projectedCounts: Record<string, number> = {};
	for (const field of COUNT_FIELDS) {
		if (Number.isSafeInteger(counts[field]) && (counts[field] as number) >= 0) {
			projectedCounts[field] = counts[field] as number;
		}
	}
	if (Object.keys(projectedCounts).length > 0) projected.counts = Object.freeze(projectedCounts);
	return Object.freeze(projected);
}

function classifyCommand(value: unknown): "test" | "check" | "build" | "git" | "generic" {
	if (typeof value !== "string" || value.length > 4096) return "generic";
	const command = value.trim().toLowerCase();
	if (/^git(?:\s|$)/u.test(command)) return "git";
	if (
		/(?:^|[;&|]\s*)(?:node\s+--test|(?:npx\s+)?vitest|pytest|cargo\s+test|go\s+test|npm\s+(?:run\s+)?test)(?:\s|$)/u.test(
			command,
		)
	)
		return "test";
	if (/(?:^|[;&|]\s*)(?:npm\s+run\s+check|biome\s+check|eslint|tsc|tsgo|cargo\s+check)(?:\s|$)/u.test(command))
		return "check";
	if (/(?:^|[;&|]\s*)(?:npm\s+run\s+build(?:\S*)?|cargo\s+build|go\s+build)(?:\s|$)/u.test(command)) return "build";
	return "generic";
}

export function projectExecutionStart(toolNameValue: unknown, argsValue: unknown) {
	const toolName = typeof toolNameValue === "string" ? toolNameValue.toLowerCase() : "";
	const toolCategory = COMMAND_TOOLS.has(toolName)
		? "command"
		: INSPECT_TOOLS.has(toolName)
			? "inspect"
			: MUTATION_TOOLS.has(toolName)
				? "mutation"
				: "other";
	return {
		toolCategory,
		...(toolCategory === "command" ? { commandCategory: classifyCommand(asRecord(argsValue).command) } : {}),
	};
}
