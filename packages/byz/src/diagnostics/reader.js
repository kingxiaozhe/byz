import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { getDiagnosticsHome } from "./config.js";
import { validatePersistedDiagnosticEvent } from "./schema.js";

async function collectRegularFiles(root, result = [], accept = () => true) {
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch {
		return result;
	}
	for (const entry of entries) {
		const path = join(root, entry.name);
		if (entry.isSymbolicLink()) continue;
		if (entry.isDirectory()) await collectRegularFiles(path, result, accept);
		else if (entry.isFile() && accept(entry.name)) result.push(path);
	}
	return result;
}

export async function scanDiagnosticEvents(options = {}) {
	const home = options.home ?? getDiagnosticsHome();
	const since = options.since ?? 0;
	const events = [];
	let unavailable = 0;
	for (const path of await collectRegularFiles(join(home, "events"), [], (name) => name.endsWith(".jsonl"))) {
		let content;
		try {
			const fileStat = await lstat(path);
			if (!fileStat.isFile() || fileStat.isSymbolicLink()) continue;
			content = await readFile(path, "utf8");
		} catch {
			unavailable++;
			continue;
		}
		const lines = content.split("\n");
		const finalLineIncomplete = lines.at(-1) !== "";
		for (const [index, line] of lines.entries()) {
			if (!line) continue;
			if (finalLineIncomplete && index === lines.length - 1) {
				unavailable++;
				continue;
			}
			try {
				const event = validatePersistedDiagnosticEvent(JSON.parse(line));
				if (!event) unavailable++;
				else if (Date.parse(event.at) >= since) events.push(event);
			} catch {
				unavailable++;
			}
		}
	}
	return { events, unavailable };
}

function increment(map, key) {
	map[key] = (map[key] ?? 0) + 1;
}

export function summarizeDiagnosticEvents(events, unavailable = 0) {
	const byEvent = {};
	const outcomes = {};
	const durations = {};
	const tools = {};
	const providers = {};
	const series = {};
	for (const item of events) {
		increment(byEvent, item.event);
		if (item.attributes.outcome) increment(outcomes, item.attributes.outcome);
		if (item.attributes.duration_bucket) increment(durations, item.attributes.duration_bucket);
		if (item.attributes.tool) increment(tools, item.attributes.tool);
		if (item.attributes.provider_category) increment(providers, item.attributes.provider_category);
		const seriesKey = [
			item.event,
			item.attributes.mode ?? "none",
			item.attributes.tool ?? "none",
			item.attributes.provider_category ?? "none",
		].join("|");
		series[seriesKey] ??= { eventCount: 0, outcomes: {}, durations: {} };
		series[seriesKey].eventCount++;
		if (item.attributes.outcome) increment(series[seriesKey].outcomes, item.attributes.outcome);
		if (item.attributes.duration_bucket) increment(series[seriesKey].durations, item.attributes.duration_bucket);
	}
	return {
		schemaVersion: 1,
		eventCount: events.length,
		unavailable,
		byEvent,
		outcomes,
		durations,
		tools,
		providers,
		series,
		dataState: events.length < 20 ? "insufficient_data" : "available",
	};
}

export async function getDiagnosticsDiskUsage(home = getDiagnosticsHome()) {
	let total = 0;
	const files = await collectRegularFiles(home);
	for (const path of files) {
		try {
			total += (await stat(path)).size;
		} catch {
			// A concurrently removed shard contributes no stable size.
		}
	}
	return total;
}

export async function readCmWorkflowSummary(options = {}) {
	const root = options.root;
	if (!root) return { state: "unavailable", runs: 0, interruptions: 0 };
	let runs = 0;
	let interruptions = 0;
	for (const path of await collectRegularFiles(join(root, "runs"), [], (name) => name.endsWith(".jsonl"))) {
		let content;
		try {
			content = await readFile(path, "utf8");
		} catch {
			continue;
		}
		let countedRun = false;
		for (const line of content.split("\n")) {
			if (!line) continue;
			try {
				const value = JSON.parse(line);
				if (!countedRun && typeof value.workflow === "string") {
					runs++;
					countedRun = true;
				}
				if (["pause", "error"].includes(value.event) || value.outcome === "blocked") interruptions++;
			} catch {
				// CM summary is optional and never exposes malformed input.
			}
		}
	}
	return { state: runs > 0 ? "available" : "unavailable", runs, interruptions };
}
