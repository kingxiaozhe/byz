import { valid } from "semver";

export const DIAGNOSTICS_SCHEMA_VERSION = 1;

const DURATION_BUCKETS = ["<10ms", "10ms-100ms", "100ms-1s", "1s-5s", "5s-30s", ">=30s", "unknown"];
const OUTCOMES = ["ok", "error", "cancelled", "timeout", "aborted", "unknown"];
const MODES = ["interactive", "print", "json", "rpc", "command", "unknown"];
const STOP_REASONS = ["stop", "length", "tool_use", "error", "aborted", "deferred", "unpaired", "unknown"];
const HTTP_CLASSES = ["2xx", "3xx", "4xx", "5xx", "network_error", "unknown"];
const PROVIDERS = ["anthropic", "openai", "google", "aws", "azure", "mistral", "openrouter", "other", "unknown"];
const TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls", "powershell", "custom", "unknown"];
const COMPONENTS = ["config", "recorder", "worker", "writer", "reader", "retention", "summary", "export", "update"];
const REASONS = [
	"disabled",
	"queue_full",
	"worker_start",
	"worker_exit",
	"permission",
	"disk_full",
	"invalid_record",
	"corrupt_file",
	"schema_mismatch",
	"generation_changed",
	"unknown",
];
const DROPPED_BUCKETS = ["1", "2-10", "11-100", ">100", "unknown"];
const RUNTIMES = ["node", "bun", "unknown"];
const ERROR_SITES = ["cli", "update", "extension", "worker", "unknown"];
const UPDATE_OUTCOMES = [
	"planned",
	"current",
	"ahead",
	"success",
	"command_failed",
	"unsupported",
	"invalid",
	"unknown",
];

const scalar = (values) => ({ kind: "enum", values: new Set(values) });
const version = { kind: "version" };

const EVENT_FIELDS = {
	"byz.app.run": {
		version,
		runtime: scalar(RUNTIMES),
		mode: scalar(MODES),
		outcome: scalar(OUTCOMES),
		duration_bucket: scalar(DURATION_BUCKETS),
	},
	"byz.agent.run": {
		mode: scalar(MODES),
		outcome: scalar(OUTCOMES),
		stop_reason: scalar(STOP_REASONS),
		duration_bucket: scalar(DURATION_BUCKETS),
	},
	"byz.model.request": {
		provider_category: scalar(PROVIDERS),
		outcome: scalar(OUTCOMES),
		http_status_class: scalar(HTTP_CLASSES),
		stop_reason: scalar(STOP_REASONS),
		duration_bucket: scalar(DURATION_BUCKETS),
	},
	"byz.tool.execution": {
		tool: scalar(TOOLS),
		outcome: scalar(OUTCOMES),
		duration_bucket: scalar(DURATION_BUCKETS),
	},
	"byz.diagnostics.degrade": {
		component: scalar(COMPONENTS),
		reason: scalar(REASONS),
		dropped_bucket: scalar(DROPPED_BUCKETS),
		error_site: scalar(ERROR_SITES),
	},
	"byz.update.run": {
		from_version: version,
		to_version: version,
		outcome: scalar(UPDATE_OUTCOMES),
		runtime: scalar(RUNTIMES),
	},
};

function validField(definition, value) {
	if (definition.kind === "version") return typeof value === "string" && valid(value) === value;
	return typeof value === "string" && definition.values.has(value);
}

export function validateDiagnosticEvent(event, attributes) {
	try {
		const fields = EVENT_FIELDS[event];
		if (!fields || !attributes || typeof attributes !== "object" || Array.isArray(attributes)) return undefined;
		const entries = Object.entries(attributes);
		if (entries.length !== Object.keys(fields).length) return undefined;
		const safe = {};
		for (const [name, value] of entries) {
			const definition = fields[name];
			if (!definition || !validField(definition, value)) return undefined;
			safe[name] = value;
		}
		return Object.freeze({
			schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
			at: new Date().toISOString(),
			event,
			attributes: Object.freeze(safe),
		});
	} catch {
		return undefined;
	}
}

export function validatePersistedDiagnosticEvent(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const keys = Object.keys(value).sort();
	if (keys.length !== 4 || keys.join(",") !== "at,attributes,event,schemaVersion") return undefined;
	if (value.schemaVersion !== DIAGNOSTICS_SCHEMA_VERSION || typeof value.at !== "string") return undefined;
	if (Number.isNaN(Date.parse(value.at))) return undefined;
	const validated = validateDiagnosticEvent(value.event, value.attributes);
	return validated ? { ...validated, at: value.at } : undefined;
}

export function bucketDuration(durationMs) {
	if (!Number.isFinite(durationMs) || durationMs < 0) return "unknown";
	if (durationMs < 10) return "<10ms";
	if (durationMs < 100) return "10ms-100ms";
	if (durationMs < 1_000) return "100ms-1s";
	if (durationMs < 5_000) return "1s-5s";
	if (durationMs < 30_000) return "5s-30s";
	return ">=30s";
}

export function bucketDropped(count) {
	if (!Number.isSafeInteger(count) || count < 1) return "unknown";
	if (count === 1) return "1";
	if (count <= 10) return "2-10";
	if (count <= 100) return "11-100";
	return ">100";
}

export function mapTool(value) {
	return TOOLS.includes(value) && value !== "custom" && value !== "unknown" ? value : "custom";
}

export function mapProvider(value) {
	const normalized = typeof value === "string" ? value.toLowerCase() : "";
	if (normalized.includes("anthropic")) return "anthropic";
	if (normalized.includes("openai")) return "openai";
	if (normalized.includes("google") || normalized.includes("gemini")) return "google";
	if (normalized.includes("bedrock") || normalized.includes("aws")) return "aws";
	if (normalized.includes("azure")) return "azure";
	if (normalized.includes("mistral")) return "mistral";
	if (normalized.includes("openrouter")) return "openrouter";
	return normalized ? "other" : "unknown";
}

export function mapHttpStatus(status) {
	if (!Number.isInteger(status)) return "unknown";
	if (status >= 200 && status < 300) return "2xx";
	if (status >= 300 && status < 400) return "3xx";
	if (status >= 400 && status < 500) return "4xx";
	if (status >= 500 && status < 600) return "5xx";
	return "unknown";
}

export function mapStopReason(value) {
	return STOP_REASONS.includes(value) ? value : "unknown";
}

export function mapMode(args, stdinIsTTY = process.stdin.isTTY, stdoutIsTTY = process.stdout.isTTY) {
	const modeIndex = args.indexOf("--mode");
	const mode = modeIndex >= 0 ? args[modeIndex + 1] : undefined;
	if (["rpc", "json"].includes(mode)) return mode;
	if (args.includes("-p") || args.includes("--print")) return "print";
	return stdinIsTTY && stdoutIsTTY ? "interactive" : "command";
}

export const SAFE_EVENT_NAMES = Object.freeze(Object.keys(EVENT_FIELDS));
