import { randomUUID } from "node:crypto";
import {
	chmodSync,
	closeSync,
	existsSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const DEFAULT_RETENTION_DAYS = 30;
export const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

export function getDiagnosticsHome(env = process.env) {
	return resolve(env.BYZ_DIAGNOSTICS_HOME || join(homedir(), ".byz", "diagnostics"));
}

export function getDefaultConfig() {
	return {
		schemaVersion: 1,
		enabled: true,
		retentionDays: DEFAULT_RETENTION_DAYS,
		maxBytes: DEFAULT_MAX_BYTES,
		detailUntil: null,
		generation: 1,
	};
}

function normalizeConfig(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return getDefaultConfig();
	return {
		schemaVersion: 1,
		enabled: typeof value.enabled === "boolean" ? value.enabled : true,
		retentionDays:
			Number.isSafeInteger(value.retentionDays) && value.retentionDays >= 1 && value.retentionDays <= 365
				? value.retentionDays
				: DEFAULT_RETENTION_DAYS,
		maxBytes:
			Number.isSafeInteger(value.maxBytes) && value.maxBytes >= 1024 * 1024 && value.maxBytes <= 1024 ** 4
				? value.maxBytes
				: DEFAULT_MAX_BYTES,
		detailUntil:
			typeof value.detailUntil === "string" && !Number.isNaN(Date.parse(value.detailUntil))
				? value.detailUntil
				: null,
		generation: Number.isSafeInteger(value.generation) && value.generation >= 1 ? value.generation : 1,
	};
}

export function readDiagnosticsConfig(home = getDiagnosticsHome()) {
	try {
		return normalizeConfig(JSON.parse(readFileSync(join(home, "config.json"), "utf8")));
	} catch {
		return getDefaultConfig();
	}
}

function assertPrivateDirectory(home) {
	if (existsSync(home)) {
		const stat = lstatSync(home);
		if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("diagnostics directory is unsafe");
		chmodSync(home, 0o700);
		return;
	}
	mkdirSync(home, { recursive: true, mode: 0o700 });
}

export function writeDiagnosticsConfig(config, home = getDiagnosticsHome()) {
	assertPrivateDirectory(home);
	const normalized = normalizeConfig(config);
	const target = join(home, "config.json");
	const temporary = join(home, `.config-${process.pid}-${randomUUID()}.tmp`);
	try {
		writeFileSync(temporary, `${JSON.stringify(normalized)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
		chmodSync(temporary, 0o600);
		renameSync(temporary, target);
		chmodSync(target, 0o600);
	} finally {
		try {
			rmSync(temporary, { force: true });
		} catch {
			// Configuration failure is reported by the explicit command only.
		}
	}
	return normalized;
}

export function parseDuration(value) {
	if (typeof value !== "string") return undefined;
	const match = /^(\d+)(m|h|d)$/.exec(value);
	if (!match) return undefined;
	const amount = Number(match[1]);
	const unitMs = match[2] === "m" ? 60_000 : match[2] === "h" ? 3_600_000 : 86_400_000;
	const duration = amount * unitMs;
	return amount >= 1 && duration <= 7 * 86_400_000 ? duration : undefined;
}

export function isDetailMode(config, now = Date.now()) {
	return config.detailUntil !== null && Date.parse(config.detailUntil) > now;
}

export function markNoticeShown(home = getDiagnosticsHome()) {
	try {
		assertPrivateDirectory(home);
		const path = join(home, "notice-shown");
		const descriptor = openSync(path, "a", 0o600);
		closeSync(descriptor);
		chmodSync(path, 0o600);
		return true;
	} catch {
		return false;
	}
}

export function wasNoticeShown(home = getDiagnosticsHome()) {
	try {
		const stat = lstatSync(join(home, "notice-shown"));
		return stat.isFile() && !stat.isSymbolicLink();
	} catch {
		return false;
	}
}

export function updateDiagnosticsConfig(changes, home = getDiagnosticsHome()) {
	return writeDiagnosticsConfig({ ...readDiagnosticsConfig(home), ...changes }, home);
}

export function getManagedPaths(home = getDiagnosticsHome()) {
	return ["events", "state", "summaries", "updates", "exports"].map((name) => join(home, name));
}

export function ensureSafeParent(path) {
	const parent = dirname(path);
	assertPrivateDirectory(parent);
	return parent;
}
