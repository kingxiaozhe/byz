import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { handleDiagnosticsCommand } from "../src/diagnostics/commands.js";
import {
	getDefaultConfig,
	isDetailMode,
	markNoticeShown,
	parseDuration,
	readDiagnosticsConfig,
	wasNoticeShown,
	writeDiagnosticsConfig,
} from "../src/diagnostics/config.js";
import { createDiagnosticsExtension, DIAGNOSTICS_NOTICE } from "../src/diagnostics/diagnostics-extension.js";
import { createDiagnosticsExport } from "../src/diagnostics/export.js";
import { scanDiagnosticEvents } from "../src/diagnostics/reader.js";
import { createDiagnosticsRecorder } from "../src/diagnostics/recorder.js";
import { enforceDiagnosticsRetention } from "../src/diagnostics/retention.js";
import {
	bucketDuration,
	mapHttpStatus,
	mapProvider,
	mapRecoveryDegradeReason,
	mapTool,
	validateDiagnosticEvent,
	validatePersistedDiagnosticEvent,
} from "../src/diagnostics/schema.js";
import {
	captureUpdateBaseline,
	compareHealth,
	getLatestUpdateComparison,
	recordUpdateResult,
} from "../src/diagnostics/update-health.js";

async function withTempDirectory(run) {
	const directory = await mkdtemp(join(tmpdir(), "byz-diagnostics-test-"));
	try {
		return await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

async function waitFor(probe, timeoutMs = 2_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const result = await probe();
		if (result) return result;
		await new Promise((resolve) => setImmediate(resolve));
	}
	throw new Error("condition was not observed before timeout");
}

function captureOutput() {
	const stdout = [];
	const stderr = [];
	return { stdout, stderr, options: { stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) } };
}

test("diagnostic schema accepts only closed low-cardinality projections", () => {
	const valid = validateDiagnosticEvent("byz.tool.execution", {
		tool: "read",
		outcome: "ok",
		duration_bucket: "<10ms",
	});
	assert.equal(valid?.event, "byz.tool.execution");
	assert.equal(validateDiagnosticEvent("byz.tool.execution", { ...valid.attributes, path: "/private" }), undefined);
	assert.equal(
		validateDiagnosticEvent("byz.tool.execution", { tool: "plugin-secret", outcome: "ok", duration_bucket: "<10ms" }),
		undefined,
	);
	assert.equal(validatePersistedDiagnosticEvent({ ...valid, prompt: "must-not-persist" }), undefined);
	assert.equal(mapTool("plugin-secret"), "custom");
	assert.equal(mapProvider("company-private-provider"), "other");
	assert.equal(mapHttpStatus(503), "5xx");
	assert.equal(bucketDuration(30_000), ">=30s");
	assert.equal(mapRecoveryDegradeReason("unsafe_path"), "permission");
	assert.equal(mapRecoveryDegradeReason("invalid_record"), "invalid_record");
	assert.equal(mapRecoveryDegradeReason("source_changed"), "generation_changed");
	assert.equal(mapRecoveryDegradeReason("size_limit"), "schema_mismatch");
	assert.equal(mapRecoveryDegradeReason("io_error"), "corrupt_file");
	assert.equal(mapRecoveryDegradeReason("raw secret reason"), "unknown");
	assert.equal(
		validateDiagnosticEvent("byz.diagnostics.degrade", {
			component: "recovery",
			reason: mapRecoveryDegradeReason("unsafe_path"),
			dropped_bucket: "1",
			error_site: "extension",
		})?.attributes.component,
		"recovery",
	);
});

test("config is private, normalized, and keeps notice state separate", () =>
	withTempDirectory(async (home) => {
		const config = writeDiagnosticsConfig({ ...getDefaultConfig(), enabled: false }, home);
		assert.equal(config.enabled, false);
		assert.equal(readDiagnosticsConfig(home).enabled, false);
		assert.equal((await stat(home)).mode & 0o777, 0o700);
		assert.equal((await stat(join(home, "config.json"))).mode & 0o777, 0o600);
		assert.equal(wasNoticeShown(home), false);
		assert.equal(markNoticeShown(home), true);
		assert.equal(wasNoticeShown(home), true);
		assert.equal(parseDuration("30m"), 1_800_000);
		assert.equal(parseDuration("8d"), undefined);
		assert.equal(isDetailMode({ detailUntil: new Date(Date.now() + 1_000).toISOString() }), true);
	}));

test("first interactive notice is deferred past other startup notifications and shown once", () =>
	withTempDirectory(async (home) => {
		let sessionStart;
		const notifications = [];
		createDiagnosticsExtension({
			home,
			mode: "interactive",
			recorder: { enabled: true, record: () => {} },
		})({
			on: (event, handler) => {
				if (event === "session_start") sessionStart = handler;
			},
		});
		const context = { ui: { notify: (message) => notifications.push(message) } };
		sessionStart({}, context);
		notifications.push("later startup notification");
		await new Promise((resolve) => setTimeout(resolve, 120));
		assert.deepEqual(notifications, ["later startup notification", DIAGNOSTICS_NOTICE]);
		assert.equal(wasNoticeShown(home), true);
		sessionStart({}, context);
		await new Promise((resolve) => setTimeout(resolve, 120));
		assert.equal(notifications.filter((message) => message === DIAGNOSTICS_NOTICE).length, 1);
	}));

test("recorder bounds in-flight work and never throws when the worker fails", () => {
	class FakeWorker extends EventEmitter {
		messages = [];
		referenced = true;
		on(event, listener) {
			this.referenced = true;
			return super.on(event, listener);
		}
		postMessage(message) {
			this.messages.push(message);
		}
		unref() {
			this.referenced = false;
		}
		terminate() {
			return Promise.resolve();
		}
	}
	const worker = new FakeWorker();
	const recorder = createDiagnosticsRecorder({
		home: "/unused",
		config: { ...getDefaultConfig(), enabled: true },
		maxInFlight: 1,
		createWorker: () => worker,
	});
	assert.doesNotThrow(() => {
		recorder.record("byz.tool.execution", { tool: "read", outcome: "ok", duration_bucket: "<10ms" });
		recorder.record("byz.tool.execution", { tool: "read", outcome: "ok", duration_bucket: "<10ms" });
	});
	assert.equal(worker.messages.length, 1);
	assert.equal(worker.referenced, false);
	worker.emit("error", new Error("fixture failure"));
	assert.doesNotThrow(() => recorder.record("invalid", { prompt: "must-not-persist" }));
	recorder.close();
});

test("real worker writes a private per-process shard without keeping the process contract", () =>
	withTempDirectory(async (home) => {
		writeDiagnosticsConfig(getDefaultConfig(), home);
		const recorder = createDiagnosticsRecorder({ home });
		for (let index = 0; index < 50; index++) {
			recorder.record("byz.tool.execution", { tool: "read", outcome: "ok", duration_bucket: "<10ms" });
		}
		const scan = await waitFor(async () => {
			const value = await scanDiagnosticEvents({ home });
			return value.events.length === 50 ? value : undefined;
		});
		assert.equal(
			scan.events.every((event) => event.attributes.tool === "read"),
			true,
		);
		const generationDir = join(home, "events", "1");
		const [day] = await readdir(generationDir);
		const [shard] = await readdir(join(generationDir, day));
		assert.equal((await stat(join(generationDir, day, shard))).mode & 0o777, 0o600);
		recorder.close();
	}));

test("diagnostics commands persist state, reject unsafe arguments, and clear by generation", () =>
	withTempDirectory(async (home) => {
		const output = captureOutput();
		process.exitCode = undefined;
		assert.equal(await handleDiagnosticsCommand(["diagnostics", "disable"], { home, ...output.options }), true);
		assert.equal(readDiagnosticsConfig(home).enabled, false);
		await handleDiagnosticsCommand(["diagnostics", "record", "--for", "30m"], { home, ...output.options });
		assert.equal(isDetailMode(readDiagnosticsConfig(home)), true);
		await mkdir(join(home, "events", "1"), { recursive: true });
		await writeFile(join(home, "events", "1", "fixture.jsonl"), "{}\n");
		await handleDiagnosticsCommand(["diagnostics", "clear"], { home, ...output.options });
		assert.equal(process.exitCode, 1);
		process.exitCode = undefined;
		await handleDiagnosticsCommand(["diagnostics", "clear", "--confirm"], { home, ...output.options });
		assert.equal(readDiagnosticsConfig(home).generation, 2);
		await assert.rejects(readdir(join(home, "events")));
		process.exitCode = undefined;
		await handleDiagnosticsCommand(["diagnostics", "export"], { home, version: "0.1.10", ...output.options });
		assert.equal(process.exitCode, 1);
		assert.match(output.stdout.at(-1), /aggregate counts/);
		await assert.rejects(readdir(join(home, "exports")));
		process.exitCode = undefined;
	}));

test("generation change stops an active old worker from recreating cleared data", () =>
	withTempDirectory(async (home) => {
		writeDiagnosticsConfig(getDefaultConfig(), home);
		const recorder = createDiagnosticsRecorder({ home });
		writeDiagnosticsConfig({ ...getDefaultConfig(), generation: 2 }, home);
		recorder.record("byz.tool.execution", { tool: "read", outcome: "ok", duration_bucket: "<10ms" });
		const state = await waitFor(async () => {
			try {
				const [name] = await readdir(join(home, "state", "1"));
				const value = JSON.parse(await readFile(join(home, "state", "1", name), "utf8"));
				return value.reason === "generation_changed" ? value : undefined;
			} catch {
				return undefined;
			}
		});
		assert.equal(state.status, "stopped");
		assert.equal((await scanDiagnosticEvents({ home })).events.length, 0);
		recorder.close();
	}));

test("retention applies across events, updates, and exports without following symlinks", () =>
	withTempDirectory(async (home) => {
		const old = new Date(Date.now() - 40 * 86_400_000);
		for (const path of [join(home, "events", "1"), join(home, "updates", "old"), join(home, "exports", "old")]) {
			await mkdir(path, { recursive: true });
			await writeFile(join(path, "data.jsonl"), "x".repeat(20));
			await utimes(join(path, "data.jsonl"), old, old);
			await utimes(path, old, old);
		}
		const outside = join(home, "outside.txt");
		await writeFile(outside, "keep");
		await symlink(outside, join(home, "events", "outside-link"));
		await enforceDiagnosticsRetention({ home, retentionDays: 30, maxBytes: 10 });
		assert.equal(await readFile(outside, "utf8"), "keep");
		await assert.rejects(readFile(join(home, "events", "1", "data.jsonl")));
		await assert.rejects(readdir(join(home, "updates", "old")));
		await assert.rejects(readdir(join(home, "exports", "old")));
	}));

test("summary tolerates malformed and incomplete rows without exposing their text", () =>
	withTempDirectory(async (home) => {
		writeDiagnosticsConfig(getDefaultConfig(), home);
		const directory = join(home, "events", "1", "2026-08-30");
		await mkdir(directory, { recursive: true });
		const valid = validateDiagnosticEvent("byz.tool.execution", {
			tool: "read",
			outcome: "ok",
			duration_bucket: "<10ms",
		});
		await writeFile(join(directory, "fixture.jsonl"), `${JSON.stringify(valid)}\nnot-json\n{`);
		const output = captureOutput();
		await handleDiagnosticsCommand(["diagnostics", "summary", "--since", "1d"], { home, ...output.options });
		const rendered = output.stdout.join("\n");
		assert.match(rendered, /"eventCount": 1/);
		assert.match(rendered, /"unavailable": 2/);
		assert.doesNotMatch(rendered, /not-json/);
	}));

test("extension reads only safe event fields", () => {
	const handlers = new Map();
	const records = [];
	createDiagnosticsExtension({
		home: "/missing",
		mode: "interactive",
		recorder: { enabled: true, record: (event, attributes) => records.push({ event, attributes }) },
	})({ on: (event, handler) => handlers.set(event, handler) });
	const toolStart = { toolCallId: "private-call", toolName: "private-plugin" };
	Object.defineProperty(toolStart, "args", { get: () => assert.fail("args must not be read") });
	handlers.get("tool_execution_start")(toolStart);
	const toolEnd = { toolCallId: "private-call", toolName: "private-plugin", isError: false };
	Object.defineProperty(toolEnd, "result", { get: () => assert.fail("result must not be read") });
	handlers.get("tool_execution_end")(toolEnd);
	const provider = {};
	Object.defineProperty(provider, "payload", { get: () => assert.fail("payload must not be read") });
	handlers.get("before_provider_request")(provider, { model: { provider: "private-provider" } });
	handlers.get("after_provider_response")({ status: 200 });
	assert.equal(records[0].attributes.tool, "custom");
	assert.equal(records[1].attributes.provider_category, "other");
});

test("export contains aggregates only and fails closed on malformed input", () =>
	withTempDirectory(async (home) => {
		writeDiagnosticsConfig(getDefaultConfig(), home);
		const directory = join(home, "events", "1", "2026-08-30");
		await mkdir(directory, { recursive: true });
		const event = validateDiagnosticEvent("byz.tool.execution", {
			tool: "read",
			outcome: "ok",
			duration_bucket: "<10ms",
		});
		await writeFile(join(directory, "valid.jsonl"), `${JSON.stringify(event)}\n`);
		const exported = await createDiagnosticsExport({ home, since: 0, byzVersion: "0.1.10" });
		assert.deepEqual((await readdir(exported)).sort(), ["manifest.json", "privacy-report.txt", "summary.json"]);
		assert.doesNotMatch(await readFile(join(exported, "summary.json"), "utf8"), /prompt|private-call/i);
		await writeFile(join(directory, "invalid.jsonl"), '{"prompt":"secret"}\n');
		await assert.rejects(createDiagnosticsExport({ home, since: 0, byzVersion: "0.1.10" }), /privacy/);
		await rm(join(directory, "invalid.jsonl"));
		const realParent = join(home, "real-output");
		await mkdir(realParent);
		await symlink(realParent, join(home, "linked-output"), "dir");
		await assert.rejects(
			createDiagnosticsExport({
				home,
				since: 0,
				byzVersion: "0.1.10",
				output: join(home, "linked-output", "bundle"),
			}),
			/unsafe/,
		);
	}));

test("update health compares only events recorded after a successful update", () =>
	withTempDirectory(async (home) => {
		writeDiagnosticsConfig(getDefaultConfig(), home);
		const directory = join(home, "events", "1", "2026-08-30");
		await mkdir(directory, { recursive: true });
		const before = Array.from({ length: 20 }, () =>
			validateDiagnosticEvent("byz.tool.execution", { tool: "read", outcome: "ok", duration_bucket: "<10ms" }),
		);
		await writeFile(join(directory, "before.jsonl"), `${before.map((value) => JSON.stringify(value)).join("\n")}\n`);
		await captureUpdateBaseline({ home, fromVersion: "0.1.10", toVersion: "0.1.11", identity: "same" });
		await recordUpdateResult({
			home,
			fromVersion: "0.1.10",
			toVersion: "0.1.11",
			outcome: "success",
			identity: "same",
		});
		const result = JSON.parse(await readFile(join(home, "updates", "0.1.10-to-0.1.11", "result.json"), "utf8"));
		const after = Array.from({ length: 20 }, () => ({
			...validateDiagnosticEvent("byz.tool.execution", { tool: "read", outcome: "error", duration_bucket: "<10ms" }),
			at: new Date(Date.parse(result.at) + 1_000).toISOString(),
		}));
		await writeFile(join(directory, "after.jsonl"), `${after.map((value) => JSON.stringify(value)).join("\n")}\n`);
		const comparison = await getLatestUpdateComparison({ home });
		assert.equal(comparison.beforeSamples, 20);
		assert.equal(comparison.afterSamples, 20);
		assert.equal(comparison.outcome, "observed_regression");
		assert.equal(comparison.correlationOnly, true);
	}));

test("BYZ CLI and complete source-tree build wire diagnostics without replacing workflow extensions", async () => {
	const cli = await readFile(new URL("../src/cli.js", import.meta.url), "utf8");
	const build = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
	const manifest = JSON.parse(await readFile(new URL("../build-manifest.json", import.meta.url), "utf8"));
	assert.match(cli, /handleDiagnosticsCommand\(commandArgs/);
	assert.match(cli, /extensionFactories: \[diagnosticsExtension\]/);
	assert.match(cli, /managedExtensionFactories:/);
	assert.match(cli, /resourcePrecedence: "before"/);
	const dynamicBranchStart = cli.indexOf("if (loadWorkflow && isInteractive)");
	const staticBranchStart = cli.indexOf("} else {", dynamicBranchStart);
	const runtimeBranchEnd = cli.indexOf("diagnostics.record", staticBranchStart);
	assert.ok(dynamicBranchStart >= 0 && staticBranchStart > dynamicBranchStart && runtimeBranchEnd > staticBranchStart);
	assert.doesNotMatch(cli.slice(dynamicBranchStart, staticBranchStart), /additionalResourcePrecedence/);
	assert.match(cli.slice(staticBranchStart, runtimeBranchEnd), /additionalResourcePrecedence: "before"/);
	assert.equal(manifest.sourceRoot, "src");
	assert.match(build, /compileSourceTree/);
	assert.doesNotMatch(build, /"src", "diagnostics"/);
});

test("health comparison enforces samples, comparability, and correlation-only outcomes", () => {
	assert.equal(compareHealth({ eventCount: 19 }, { eventCount: 20 }).outcome, "insufficient_data");
	assert.equal(
		compareHealth({ eventCount: 20 }, { eventCount: 20 }, { before: "a", after: "b" }).outcome,
		"not_comparable",
	);
	assert.equal(
		compareHealth(
			{ eventCount: 20, tools: { read: 20 } },
			{ eventCount: 20, tools: { custom: 20 } },
			{ before: "same", after: "same" },
		).outcome,
		"not_comparable",
	);
	const regression = compareHealth(
		{ eventCount: 20, outcomes: { error: 0 } },
		{ eventCount: 20, outcomes: { error: 2 } },
		{ before: "same", after: "same" },
	);
	assert.equal(regression.outcome, "observed_regression");
	assert.equal(regression.correlationOnly, true);
});
