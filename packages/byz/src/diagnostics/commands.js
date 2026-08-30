import { constants } from "node:fs";
import { access, lstat, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	getDiagnosticsHome,
	getManagedPaths,
	isDetailMode,
	parseDuration,
	readDiagnosticsConfig,
	updateDiagnosticsConfig,
	writeDiagnosticsConfig,
} from "./config.js";
import { createDiagnosticsExport } from "./export.js";
import {
	getDiagnosticsDiskUsage,
	readCmWorkflowSummary,
	scanDiagnosticEvents,
	summarizeDiagnosticEvents,
} from "./reader.js";
import { getLatestUpdateComparison } from "./update-health.js";

const USAGE = `Usage:
  byz diagnostics status
  byz diagnostics enable|disable
  byz diagnostics record --for <Nm|Nh|Nd>
  byz diagnostics record --stop
  byz diagnostics summary [--since <Nm|Nh|Nd>]
  byz diagnostics doctor
  byz diagnostics clear --confirm
  byz diagnostics export [--since <duration>] [--output <path>] --confirm`;

function fail(message, stderr) {
	stderr(message);
	process.exitCode = 1;
}

function parseSingleOption(args, name) {
	const index = args.indexOf(name);
	if (index < 0 || index !== args.lastIndexOf(name)) return undefined;
	return args[index + 1];
}

async function statusCommand(home, stdout) {
	const config = readDiagnosticsConfig(home);
	const bytes = await getDiagnosticsDiskUsage(home);
	const scan = await scanDiagnosticEvents({ home });
	const lastEventAt =
		scan.events.reduce((latest, event) => (event.at > latest ? event.at : latest), "") || "unavailable";
	const droppedEvents = scan.events.filter(
		(event) => event.event === "byz.diagnostics.degrade" && event.attributes.reason === "queue_full",
	).length;
	stdout(`enabled: ${config.enabled}`);
	stdout(`mode: ${isDetailMode(config) ? "temporary-detail" : "basic"}`);
	stdout(`retentionDays: ${config.retentionDays}`);
	stdout(`maxBytes: ${config.maxBytes}`);
	stdout(`usedBytes: ${bytes}`);
	stdout(`generation: ${config.generation}`);
	stdout(`lastEventAt: ${lastEventAt}`);
	stdout(`dropSummaries: ${droppedEvents}`);
	stdout(`degraded: ${scan.unavailable > 0}`);
}

async function summaryCommand(args, home, stdout, stderr) {
	const value = parseSingleOption(args, "--since") ?? "24h";
	const duration = parseDuration(value);
	if (!duration || args.length !== (args.includes("--since") ? 2 : 0)) return fail(USAGE, stderr);
	const scan = await scanDiagnosticEvents({ home, since: Date.now() - duration });
	const summary = summarizeDiagnosticEvents(scan.events, scan.unavailable);
	const cmRoot = process.env.CM_WORKFLOW_LOG_HOME || join(homedir(), ".cm-workflow", "logs");
	const cm = await readCmWorkflowSummary({ root: cmRoot });
	const update = await getLatestUpdateComparison({
		home,
		identity: `node-${process.versions.node.split(".")[0]}-${process.platform}`,
	});
	stdout(JSON.stringify({ range: value, ...summary, cm, update: update ?? { state: "unavailable" } }, null, 2));
}

async function doctorCommand(home, stdout) {
	const checks = { config: "ok", directory: "ok", schema: "ok", capacity: "ok" };
	try {
		const info = await lstat(home);
		if (!info.isDirectory() || info.isSymbolicLink()) checks.directory = "unsafe";
		await access(home, constants.R_OK);
	} catch {
		checks.directory = "unavailable";
	}
	try {
		JSON.parse(await readFile(join(home, "config.json"), "utf8"));
	} catch {
		checks.config = "default_or_invalid";
	}
	const scan = await scanDiagnosticEvents({ home });
	if (scan.unavailable > 0) checks.schema = "unavailable_records";
	if ((await getDiagnosticsDiskUsage(home)) > readDiagnosticsConfig(home).maxBytes) checks.capacity = "over_limit";
	stdout(JSON.stringify(checks, null, 2));
}

async function clearCommand(args, home, stdout, stderr) {
	if (args.length !== 1 || args[0] !== "--confirm")
		return fail("Refusing to clear diagnostics without --confirm.", stderr);
	const config = readDiagnosticsConfig(home);
	writeDiagnosticsConfig({ ...config, generation: config.generation + 1, detailUntil: null }, home);
	const failed = [];
	for (const path of getManagedPaths(home)) {
		try {
			const info = await lstat(path).catch(() => undefined);
			if (info?.isSymbolicLink()) throw new Error("unsafe");
			await rm(path, { recursive: true, force: true });
		} catch {
			failed.push(path.split("/").at(-1));
		}
	}
	if (failed.length > 0) {
		process.exitCode = 2;
		stderr(`Diagnostics partially cleared; remaining categories: ${failed.join(", ")}`);
		return;
	}
	stdout("Diagnostics cleared.");
}

async function exportCommand(args, home, options, stdout, stderr) {
	const sinceValue = parseSingleOption(args, "--since") ?? "24h";
	const sinceDuration = parseDuration(sinceValue);
	const output = parseSingleOption(args, "--output");
	const confirmed = args.includes("--confirm");
	const allowedLength = (confirmed ? 1 : 0) + (args.includes("--since") ? 2 : 0) + (args.includes("--output") ? 2 : 0);
	if (!sinceDuration || args.length !== allowedLength) return fail(USAGE, stderr);
	const preview = await scanDiagnosticEvents({ home, since: Date.now() - sinceDuration });
	stdout(
		`Export range: ${sinceValue}; events: ${preview.events.length}; fields: aggregate counts and versions; excludes prompts, code, paths, tool content and credentials; output: ${output ?? "managed exports directory"}.`,
	);
	if (!confirmed) return fail("Review the preview, then rerun with --confirm.", stderr);
	try {
		const path = await createDiagnosticsExport({
			home,
			since: Date.now() - sinceDuration,
			output,
			byzVersion: options.version,
			runtimeCategory: "node",
		});
		stdout(`Diagnostics exported to: ${path}`);
	} catch {
		process.exitCode = 2;
		stderr("Diagnostics export failed privacy or filesystem validation.");
	}
}

export async function handleDiagnosticsCommand(args, options = {}) {
	if (args[0] !== "diagnostics") return false;
	const stdout = options.stdout ?? console.log;
	const stderr = options.stderr ?? console.error;
	const home = options.home ?? getDiagnosticsHome(options.env);
	const [command, ...rest] = args.slice(1);
	try {
		if (command === "status" && rest.length === 0) await statusCommand(home, stdout);
		else if (command === "enable" && rest.length === 0) {
			updateDiagnosticsConfig({ enabled: true }, home);
			stdout("Diagnostics enabled locally.");
		} else if (command === "disable" && rest.length === 0) {
			updateDiagnosticsConfig({ enabled: false, detailUntil: null }, home);
			stdout("Diagnostics disabled.");
		} else if (command === "record" && rest[0] === "--stop" && rest.length === 1) {
			updateDiagnosticsConfig({ detailUntil: null }, home);
			stdout("Temporary detailed diagnostics stopped.");
		} else if (command === "record" && rest[0] === "--for" && rest.length === 2) {
			const duration = parseDuration(rest[1]);
			if (!duration) fail(USAGE, stderr);
			else {
				updateDiagnosticsConfig(
					{ enabled: true, detailUntil: new Date(Date.now() + duration).toISOString() },
					home,
				);
				stdout("Temporary detailed diagnostics enabled.");
			}
		} else if (command === "summary") await summaryCommand(rest, home, stdout, stderr);
		else if (command === "doctor" && rest.length === 0) await doctorCommand(home, stdout);
		else if (command === "clear") await clearCommand(rest, home, stdout, stderr);
		else if (command === "export") await exportCommand(rest, home, options, stdout, stderr);
		else fail(USAGE, stderr);
	} catch {
		process.exitCode = 2;
		stderr("Diagnostics storage is unavailable.");
	}
	return true;
}

export { USAGE as DIAGNOSTICS_USAGE };
