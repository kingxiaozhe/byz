// A release notice must never delay, block or surprise the user: startup reads a cached answer
// from disk and nothing else, the refresh happens detached after the session is already usable,
// and every failure stays silent. BYZ_UPDATE_CHECK=0 turns the whole thing off.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { gt, valid } from "semver";

const CACHE_FILE = "latest.json";
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function resolveUpdateHome(env = process.env) {
	return resolve(env.BYZ_UPDATE_HOME || join(homedir(), ".byz", "update"));
}

export function updateCheckEnabled(env = process.env) {
	return env.BYZ_UPDATE_CHECK !== "0";
}

function parseCache(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	if (valid(value.version) !== value.version) return undefined;
	if (!Number.isSafeInteger(value.checkedAt) || value.checkedAt <= 0) return undefined;
	return { checkedAt: value.checkedAt, version: value.version };
}

export function readCachedRelease(home = resolveUpdateHome()) {
	try {
		return parseCache(JSON.parse(readFileSync(join(home, CACHE_FILE), "utf8")));
	} catch {
		// A missing, unreadable or damaged cache simply means there is nothing to report yet.
		return undefined;
	}
}

export function writeCachedRelease(release, home = resolveUpdateHome()) {
	const entry = parseCache(release);
	if (!entry) return false;
	try {
		mkdirSync(home, { mode: 0o700, recursive: true });
		const temporary = join(home, `.${CACHE_FILE}-${process.pid}.tmp`);
		writeFileSync(temporary, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
		renameSync(temporary, join(home, CACHE_FILE));
		return true;
	} catch {
		return false;
	}
}

export function isCacheFresh(cached, now, maxAgeMs = DEFAULT_MAX_AGE_MS) {
	if (!cached) return false;
	const age = now - cached.checkedAt;
	// A timestamp from the future means a clock change, not a fresh answer.
	return age >= 0 && age < maxAgeMs;
}

/** The line to print, or undefined when there is nothing worth saying. */
export function formatUpdateNotice(currentVersion, cached) {
	if (!cached || valid(currentVersion) !== currentVersion) return undefined;
	if (!gt(cached.version, currentVersion)) return undefined;
	return `BYZ ${cached.version} is available (you have ${currentVersion}). Update with: byz update`;
}

/** True when a background refresh is worth starting. */
export function shouldRefresh(cached, now, options = {}) {
	if (!updateCheckEnabled(options.env ?? process.env)) return false;
	return !isCacheFresh(cached, now, options.maxAgeMs ?? DEFAULT_MAX_AGE_MS);
}
