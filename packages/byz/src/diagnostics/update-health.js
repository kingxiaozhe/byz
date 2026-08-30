import { chmod, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { valid } from "semver";
import { getDiagnosticsHome } from "./config.js";
import { scanDiagnosticEvents, summarizeDiagnosticEvents } from "./reader.js";

const MIN_SAMPLES = 20;

function safeVersion(value) {
	return typeof value === "string" && valid(value) === value ? value : undefined;
}

function safeIdentity(value) {
	return typeof value === "string" && /^node-\d+-(aix|darwin|freebsd|linux|openbsd|sunos|win32)$/.test(value)
		? value
		: "unknown";
}

function sameCategories(before, after, field) {
	return (
		JSON.stringify(Object.keys(before?.[field] ?? {}).sort()) ===
		JSON.stringify(Object.keys(after?.[field] ?? {}).sort())
	);
}

function compareOutcome(before, after) {
	const delta = (after.outcomes?.error ?? 0) / after.eventCount - (before.outcomes?.error ?? 0) / before.eventCount;
	return delta >= 0.05 ? "observed_regression" : delta <= -0.05 ? "improved" : "stable";
}

export function compareHealth(before, after, identity = {}) {
	const beforeSamples = before?.eventCount ?? 0;
	const afterSamples = after?.eventCount ?? 0;
	if (before?.unavailable > 0 || after?.unavailable > 0) {
		return {
			comparability: "insufficient_data",
			outcome: "insufficient_data",
			beforeSamples,
			afterSamples,
			correlationOnly: true,
		};
	}
	if (identity.before !== identity.after) {
		return {
			comparability: "not_comparable",
			outcome: "not_comparable",
			beforeSamples,
			afterSamples,
			correlationOnly: true,
		};
	}
	const beforeSeries = before?.series ?? {};
	const afterSeries = after?.series ?? {};
	if (Object.keys(beforeSeries).length > 0 || Object.keys(afterSeries).length > 0) {
		const common = Object.keys(beforeSeries).filter((key) => afterSeries[key]);
		if (common.length === 0) {
			return {
				comparability: "not_comparable",
				outcome: "not_comparable",
				beforeSamples,
				afterSamples,
				correlationOnly: true,
			};
		}
		const comparisons = common
			.filter((key) => beforeSeries[key].eventCount >= MIN_SAMPLES && afterSeries[key].eventCount >= MIN_SAMPLES)
			.map((key) => ({
				series: key,
				beforeSamples: beforeSeries[key].eventCount,
				afterSamples: afterSeries[key].eventCount,
				outcome: compareOutcome(beforeSeries[key], afterSeries[key]),
			}));
		if (comparisons.length === 0) {
			return {
				comparability: "insufficient_data",
				outcome: "insufficient_data",
				beforeSamples,
				afterSamples,
				correlationOnly: true,
			};
		}
		const outcome = comparisons.some((item) => item.outcome === "observed_regression")
			? "observed_regression"
			: comparisons.every((item) => item.outcome === "improved")
				? "improved"
				: "stable";
		return { comparability: "comparable", outcome, beforeSamples, afterSamples, comparisons, correlationOnly: true };
	}
	if (
		beforeSamples < MIN_SAMPLES ||
		afterSamples < MIN_SAMPLES ||
		!sameCategories(before, after, "byEvent") ||
		!sameCategories(before, after, "tools") ||
		!sameCategories(before, after, "providers")
	) {
		const categoriesMatch =
			sameCategories(before, after, "byEvent") &&
			sameCategories(before, after, "tools") &&
			sameCategories(before, after, "providers");
		return {
			comparability: categoriesMatch ? "insufficient_data" : "not_comparable",
			outcome: categoriesMatch ? "insufficient_data" : "not_comparable",
			beforeSamples,
			afterSamples,
			correlationOnly: true,
		};
	}
	return {
		comparability: "comparable",
		outcome: compareOutcome(before, after),
		beforeSamples,
		afterSamples,
		correlationOnly: true,
	};
}

export async function captureUpdateBaseline(options) {
	const home = options.home ?? getDiagnosticsHome();
	const fromVersion = safeVersion(options.fromVersion);
	const toVersion = safeVersion(options.toVersion);
	if (!fromVersion || !toVersion) return false;
	const scan = await scanDiagnosticEvents({ home, since: Date.now() - 7 * 86_400_000 });
	const directory = join(home, "updates", `${fromVersion}-to-${toVersion}`);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
	await writeFile(
		join(directory, "baseline.json"),
		`${JSON.stringify({ schemaVersion: 1, fromVersion, toVersion, generatedAt: new Date().toISOString(), summary: summarizeDiagnosticEvents(scan.events, scan.unavailable), identity: safeIdentity(options.identity) })}\n`,
		{ mode: 0o600 },
	);
	return true;
}

export async function recordUpdateResult(options) {
	const home = options.home ?? getDiagnosticsHome();
	const fromVersion = safeVersion(options.fromVersion);
	const toVersion = safeVersion(options.toVersion);
	if (!fromVersion || !toVersion) return false;
	const directory = join(home, "updates", `${fromVersion}-to-${toVersion}`);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await writeFile(
		join(directory, "result.json"),
		`${JSON.stringify({ schemaVersion: 1, fromVersion, toVersion, at: new Date().toISOString(), outcome: options.outcome === "success" ? "success" : "command_failed", identity: safeIdentity(options.identity) })}\n`,
		{ mode: 0o600 },
	);
	return true;
}

export async function getLatestUpdateComparison(options = {}) {
	const home = options.home ?? getDiagnosticsHome();
	let directories;
	try {
		directories = await readdir(join(home, "updates"), { withFileTypes: true });
	} catch {
		return undefined;
	}
	for (const entry of directories.filter((item) => item.isDirectory()).reverse()) {
		const directory = join(home, "updates", entry.name);
		try {
			const baseline = JSON.parse(await readFile(join(directory, "baseline.json"), "utf8"));
			const result = JSON.parse(await readFile(join(directory, "result.json"), "utf8"));
			if (result.outcome !== "success") continue;
			const scan = await scanDiagnosticEvents({ home, since: Date.parse(result.at) });
			const after = summarizeDiagnosticEvents(scan.events, scan.unavailable);
			return {
				schemaVersion: 1,
				fromVersion: baseline.fromVersion,
				toVersion: baseline.toVersion,
				...compareHealth(baseline.summary, after, {
					before: baseline.identity,
					after: safeIdentity(options.identity),
				}),
			};
		} catch {
			// Invalid update records are not guessed or migrated.
		}
	}
	return undefined;
}

export async function clearUpdateHealth(home = getDiagnosticsHome()) {
	await rm(join(home, "updates"), { recursive: true, force: true });
}
