import assert from "node:assert/strict";
import test from "node:test";
import { createPauseController } from "../src/execution/pause-controller.js";
import { createPauseExtension } from "../src/execution/pause-extension.js";

function createHarness(options = {}) {
	const commands = new Map();
	const handlers = new Map();
	const entries = [];
	const notifications = [];
	const context = {
		signal: undefined,
		ui: { notify: (message, level) => notifications.push({ level, message }) },
		isIdle: () => false,
		readPauseEntries: () => options.entries ?? [],
	};
	const controller = options.controller ?? createPauseController(options.controllerOptions);
	createPauseExtension({ controller })({
		on(event, handler) {
			handlers.set(event, handler);
		},
		registerCommand(name, command) {
			commands.set(name, command);
		},
		appendEntry(entry) {
			if (options.failAppend) throw new Error("append failed");
			entries.push(entry);
		},
	});
	return {
		commands,
		context,
		controller,
		entries,
		handlers,
		notifications,
		emit: (event, value = {}) => handlers.get(event)?.({ type: event, ...value }, context),
		run: (args = "") => commands.get("pause").handler(args, context),
	};
}

test("pause command gates a post-request tool until admitted tools drain and resume", async () => {
	const harness = createHarness();
	await harness.emit("agent_start");
	await harness.emit("tool_batch_start", { toolCalls: [{ toolCallId: "a", toolName: "write" }] });
	await harness.emit("tool_execution_start", { toolCallId: "a", toolName: "write" });
	assert.equal(await harness.emit("tool_call", { toolCallId: "a", toolName: "write" }), undefined);
	await harness.run();
	assert.equal(harness.controller.snapshot().state, "requested");
	await harness.emit("tool_batch_start", { toolCalls: [{ toolCallId: "c", toolName: "bash" }] });
	await harness.emit("tool_execution_start", { toolCallId: "c", toolName: "bash" });
	const blocked = harness.emit("tool_call", { toolCallId: "c", toolName: "bash" });
	await Promise.resolve();
	assert.equal(harness.controller.snapshot().state, "requested");
	await harness.emit("tool_execution_end", { toolCallId: "a", toolName: "write" });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(harness.controller.snapshot().state, "paused");
	assert.ok(harness.entries.some((entry) => entry.state === "paused"));
	await harness.run("resume");
	assert.equal(await blocked, undefined);
	assert.equal(harness.controller.snapshot().state, "running");
	assert.ok(harness.entries.some((entry) => entry.state === "requested"));
});

test("a pause requested while a parallel batch is preparing does not deadlock later calls in that batch", async () => {
	const harness = createHarness();
	await harness.emit("agent_start");
	await harness.emit("tool_batch_start", {
		toolCalls: [
			{ toolCallId: "a", toolName: "write" },
			{ toolCallId: "b", toolName: "read" },
		],
	});
	await harness.emit("tool_execution_start", { toolCallId: "a", toolName: "write" });
	assert.equal(await harness.emit("tool_call", { toolCallId: "a", toolName: "write" }), undefined);
	await harness.run();
	await harness.emit("tool_execution_start", { toolCallId: "b", toolName: "read" });
	assert.equal(await harness.emit("tool_call", { toolCallId: "b", toolName: "read" }), undefined);
	await harness.emit("tool_execution_end", { toolCallId: "b", toolName: "read" });
	await harness.emit("tool_execution_end", { toolCallId: "a", toolName: "write" });
	const nextModel = harness.emit("model_request_gate");
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(harness.controller.snapshot().state, "paused");
	await harness.run("resume");
	await nextModel;
});

test("registry snapshot failure writes a closed cancellation receipt", async () => {
	const controller = createPauseController({
		readRegistrySnapshot: () => {
			throw new Error("registry unavailable");
		},
	});
	const harness = createHarness({ controller });
	await harness.emit("agent_start");
	await harness.run();
	await assert.rejects(harness.emit("model_request_gate"), /cancelled by pause gate/);
	assert.equal(harness.controller.snapshot().state, "running");
	assert.equal(harness.entries.at(-1).reason, "registry_unavailable");
	await harness.emit("agent_settled");
	assert.equal(harness.entries.at(-1).reason, "registry_unavailable");
});

test("cancelled model and tool gates block instead of authorizing stale actions", async () => {
	const harness = createHarness();
	await harness.emit("agent_start");
	await harness.run();
	const modelGate = harness.emit("model_request_gate");
	await new Promise((resolve) => setImmediate(resolve));
	await harness.emit("session_shutdown");
	await assert.rejects(modelGate, /cancelled by pause gate/);

	await harness.emit("agent_start");
	await harness.run();
	const toolGate = harness.emit("tool_call", { toolCallId: "later", toolName: "bash" });
	await new Promise((resolve) => setImmediate(resolve));
	await harness.emit("agent_settled");
	assert.deepEqual(await toolGate, { block: true, terminate: true, reason: "Pause gate was cancelled." });
});

test("agent_end keeps the request while agent_settled closes it", async () => {
	const harness = createHarness();
	await harness.emit("agent_start");
	await harness.run();
	await harness.emit("agent_end");
	assert.equal(harness.controller.snapshot().state, "requested");
	await harness.emit("agent_settled");
	assert.equal(harness.controller.snapshot().state, "idle");
});

test("idle, status, duplicate resume, stale receipts, and append failure are safe", async () => {
	const idle = createHarness();
	await idle.run();
	assert.match(idle.notifications.at(-1).message, /no running task/);
	await idle.run("resume");
	assert.match(idle.notifications.at(-1).message, /no paused live gate/);

	const stale = createHarness({ entries: [{ schemaVersion: 1, state: "paused", generation: 3 }] });
	await stale.emit("session_start", { reason: "startup" });
	await stale.run("status");
	assert.match(stale.notifications.at(-1).message, /stale/);

	const failed = createHarness({ failAppend: true });
	await failed.emit("agent_start");
	await failed.run();
	assert.equal(failed.controller.snapshot().state, "requested");
	assert.ok(failed.notifications.some((entry) => /audit receipt/.test(entry.message)));
});

test("cancel reports and receipts a requested gate even before paused", async () => {
	const harness = createHarness();
	await harness.emit("agent_start");
	await harness.run();
	await harness.run("cancel");
	assert.equal(harness.controller.snapshot().state, "running");
	assert.equal(harness.notifications.at(-1).message, "Pause: cancelled.");
	assert.equal(harness.entries.at(-1).state, "running");
});

test("paused status and receipts expose only bounded registry identity and duration bucket", async () => {
	let now = 0;
	const registry = Object.freeze({
		availability: "available",
		plan: Object.freeze({ id: "plan-1", active: Object.freeze({ id: "task-2", ordinal: 2 }) }),
	});
	const harness = createHarness({
		controllerOptions: { now: () => now, readRegistrySnapshot: () => registry },
	});
	await harness.emit("agent_start");
	await harness.run();
	const gate = harness.emit("model_request_gate");
	await new Promise((resolve) => setImmediate(resolve));
	now = 8_000;
	await harness.run("status");
	assert.match(harness.notifications.at(-1).message, /task=task-2/);
	const paused = harness.entries.find((entry) => entry.state === "paused");
	assert.deepEqual(paused, {
		schemaVersion: 1,
		boundary: "model",
		durationBucket: "<1s",
		generation: 1,
		planId: "plan-1",
		state: "paused",
		taskId: "task-2",
	});
	await harness.run("resume");
	await gate;
	assert.equal(harness.entries.at(-1).durationBucket, "<10s");
});

test("shutdown closure receipts preserve paused registry and duration facts", async () => {
	let now = 0;
	const registry = Object.freeze({
		availability: "available",
		plan: Object.freeze({ id: "plan-close", active: Object.freeze({ id: "task-close", ordinal: 1 }) }),
	});
	const harness = createHarness({ controllerOptions: { now: () => now, readRegistrySnapshot: () => registry } });
	await harness.emit("agent_start");
	await harness.run();
	const gate = harness.emit("model_request_gate");
	await new Promise((resolve) => setImmediate(resolve));
	now = 12_000;
	await harness.emit("session_shutdown", { reason: "shutdown" });
	await assert.rejects(gate, /cancelled by pause gate/);
	assert.deepEqual(harness.entries.at(-1), {
		schemaVersion: 1,
		boundary: "model",
		durationBucket: "<1m",
		generation: 1,
		planId: "plan-close",
		reason: "shutdown",
		state: "idle",
		taskId: "task-close",
	});
});

test("reload cancels a live gate and the next extension projects its receipt as stale", async () => {
	const first = createHarness();
	await first.emit("agent_start");
	await first.run();
	const gate = first.emit("model_request_gate");
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(first.controller.snapshot().state, "paused");
	await first.emit("session_shutdown", { reason: "reload" });
	await assert.rejects(gate, /cancelled by pause gate/);
	assert.equal(first.entries.at(-1).state, "stale");

	const reloaded = createHarness({ entries: first.entries });
	await reloaded.emit("session_start", { reason: "reload" });
	await reloaded.run("status");
	assert.match(reloaded.notifications.at(-1).message, /stale/);
});

test("pause registers no resume command", () => {
	const harness = createHarness();
	assert.deepEqual([...harness.commands.keys()], ["pause"]);
});
