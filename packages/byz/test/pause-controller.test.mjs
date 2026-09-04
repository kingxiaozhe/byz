import assert from "node:assert/strict";
import test from "node:test";
import { createPauseController } from "../src/execution/pause-controller.js";

test("idle requests do not arm the next run and duplicate requests are idempotent", () => {
	const controller = createPauseController();
	assert.equal(controller.request().reason, "idle");
	assert.equal(controller.snapshot().state, "idle");
	controller.startRun();
	assert.equal(controller.request().reason, "requested");
	assert.equal(controller.request().reason, "duplicate");
	assert.equal(controller.snapshot().state, "requested");
});

test("admitted and in-flight tools drain before one shared paused gate", async () => {
	let now = 0;
	const registry = Object.freeze({ availability: "available", marker: "boundary" });
	const controller = createPauseController({ now: () => now, readRegistrySnapshot: () => registry });
	controller.startRun();
	assert.equal(controller.admitTool("a"), true);
	assert.equal(controller.admitTool("b"), true);
	assert.equal(controller.toolStarted("b"), true);
	controller.request();
	const blocked = controller.reachBoundary("tool");
	await Promise.resolve();
	assert.equal(controller.snapshot().state, "requested");
	controller.toolEnded("b");
	assert.equal(controller.snapshot().state, "requested");
	controller.toolEnded("a");
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(controller.snapshot().state, "paused");
	assert.equal(controller.snapshot().pausedRegistrySnapshot, registry);
	now = 8_000;
	assert.equal(controller.snapshot().waitingMs, 8_000);
	assert.equal(controller.resume(), true);
	assert.equal(await blocked, "resumed");
	assert.equal(controller.snapshot().state, "running");
	assert.equal(controller.resume(), false);
});

test("cancelled typed gates never authorize stale continuations", async () => {
	const controller = createPauseController();
	const first = controller.startRun();
	controller.request();
	const blocked = controller.reachBoundary("model");
	await Promise.resolve();
	assert.equal(controller.snapshot().state, "paused");
	controller.settle("reload");
	assert.equal(await blocked, "cancelled");
	assert.equal(controller.snapshot().state, "stale");
	const second = controller.startRun();
	assert.ok(second.generation > first.generation);
	assert.equal(controller.resume(first.generation), false);
	assert.equal(controller.snapshot().state, "running");
});

test("agent segment end does not settle and confirmation lease rejects nested pause", async () => {
	const controller = createPauseController();
	controller.startRun();
	const confirmationGeneration = controller.beginConfirmation();
	assert.equal(confirmationGeneration, 1);
	assert.equal(controller.request().reason, "confirmation");
	controller.endConfirmation(confirmationGeneration);
	controller.request();
	const blocked = controller.reachBoundary("model");
	await Promise.resolve();
	assert.equal(controller.snapshot().state, "paused");
	controller.cancel();
	assert.equal(await blocked, "cancelled");
});

test("pre-aborted boundaries and throwing observers cannot strand gates", async () => {
	const abort = new AbortController();
	abort.abort();
	const controller = createPauseController({
		onPause: () => {
			throw new Error("timing failed");
		},
		onResume: () => {
			throw new Error("timing failed");
		},
	});
	controller.subscribe(() => {
		throw new Error("observer failed");
	});
	controller.startRun();
	assert.doesNotThrow(() => controller.request());
	assert.equal(await controller.reachBoundary("model", abort.signal), "cancelled");
	controller.cancel();
	controller.request();
	const blocked = controller.reachBoundary("model");
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(controller.snapshot().state, "paused");
	assert.doesNotThrow(() => controller.resume());
	assert.equal(await blocked, "resumed");
});

test("stale confirmation finalizers cannot clear a newer generation lease", () => {
	const controller = createPauseController();
	controller.startRun();
	const first = controller.beginConfirmation();
	controller.settle("reload");
	controller.startRun();
	const second = controller.beginConfirmation();
	assert.notEqual(first, second);
	assert.equal(controller.endConfirmation(first), false);
	assert.equal(controller.isConfirmationActive(), true);
	assert.equal(controller.request().reason, "confirmation");
});

test("registry snapshot failures cancel without leaving an unresumable paused state", async () => {
	const controller = createPauseController({
		readRegistrySnapshot: () => {
			throw new Error("registry unavailable");
		},
	});
	controller.startRun();
	controller.request();
	assert.equal(await controller.reachBoundary("model"), "cancelled");
	assert.equal(controller.snapshot().state, "running");
	assert.equal(controller.resume(), false);
});

test("pause freezes registry facts only at the actual drained boundary", async () => {
	let registry = Object.freeze({ evidence: 1, state: "in_progress" });
	const controller = createPauseController({ readRegistrySnapshot: () => registry });
	controller.startRun();
	controller.admitTool("a");
	controller.request();
	const blocked = controller.reachBoundary("model");
	registry = Object.freeze({ evidence: 2, state: "in_progress" });
	controller.toolEnded("a");
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(controller.snapshot().pausedRegistrySnapshot, registry);
	controller.resume();
	assert.equal(await blocked, "resumed");
});
