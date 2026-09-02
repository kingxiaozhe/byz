import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionRegistry } from "../src/execution/execution-registry.js";

function createHarness(options = {}) {
	const entries = [];
	const registry = createExecutionRegistry({
		appendReceipt(receipt) {
			if (options.appendError) throw new Error("session append failed");
			entries.push(structuredClone(receipt));
		},
		createPlanId(generation) {
			return `plan-${generation}`;
		},
		...options,
	});
	return { entries, registry };
}

function openPlan(registry, tasks = [{ id: "A" }, { id: "B" }]) {
	const result = registry.dispatch({ action: "plan_open", tasks });
	assert.equal(result.accepted, true);
	return result.planId;
}

function sealAndStart(registry, taskId = "A") {
	const planId = openPlan(registry);
	assert.equal(registry.dispatch({ action: "plan_seal", planId }).accepted, true);
	assert.equal(registry.dispatch({ action: "task_start", planId, taskId }).accepted, true);
	return planId;
}

test("starts empty and exposes ordinal only after an atomic plan is sealed", () => {
	const { entries, registry } = createHarness();
	assert.deepEqual(registry.snapshot(), { availability: "empty", generation: 0 });
	const planId = openPlan(registry, [
		{ id: "one", label: "first" },
		{ id: "two", label: "second" },
		{ id: "three" },
		{ id: "four" },
	]);
	assert.equal(registry.snapshot().plan.total, undefined);
	assert.equal(registry.dispatch({ action: "plan_seal", planId }).accepted, true);
	assert.equal(registry.dispatch({ action: "task_start", planId, taskId: "two" }).accepted, true);
	assert.deepEqual(registry.snapshot().plan.active, { id: "two", ordinal: 2 });
	assert.equal(registry.snapshot().plan.total, 4);
	assert.equal(entries.length, 3);
});

test("uses a distinct host identity for each explicit plan generation", () => {
	const { registry } = createHarness();
	const firstPlanId = sealAndStart(registry);
	registry.dispatch({ action: "task_finish", planId: firstPlanId, taskId: "A", outcome: "completed" });
	registry.dispatch({ action: "task_start", planId: firstPlanId, taskId: "B" });
	registry.dispatch({ action: "task_finish", planId: firstPlanId, taskId: "B", outcome: "completed" });
	const secondPlanId = openPlan(registry, [{ id: "new" }]);
	assert.notEqual(secondPlanId, firstPlanId);
	assert.equal(registry.snapshot().generation, 2);
});

test("accepts exact task and ID bounds", () => {
	const exactTaskLimit = createHarness();
	const tasks = Array.from({ length: 64 }, (_, index) => ({ id: `task-${index}` }));
	const planId = openPlan(exactTaskLimit.registry, tasks);
	assert.equal(exactTaskLimit.registry.dispatch({ action: "plan_seal", planId }).accepted, true);
	assert.equal(exactTaskLimit.registry.snapshot().plan.total, 64);
	const exactIdLimit = createHarness();
	assert.equal(openPlan(exactIdLimit.registry, [{ id: "x".repeat(64) }]), "plan-1");
});

test("rejects empty, oversized, duplicate, malformed, and mutable sealed task sets", () => {
	for (const tasks of [
		[],
		Array.from({ length: 65 }, (_, index) => ({ id: `task-${index}` })),
		[{ id: "same" }, { id: "same" }],
		[{ id: "contains space" }],
		[{ id: "x".repeat(65) }],
		[{ id: "A", label: "x".repeat(121) }],
	]) {
		const { registry } = createHarness();
		assert.equal(registry.dispatch({ action: "plan_open", tasks }).accepted, false);
		assert.deepEqual(registry.snapshot(), { availability: "empty", generation: 0 });
	}
	const { registry } = createHarness();
	const planId = openPlan(registry);
	registry.dispatch({ action: "plan_seal", planId });
	assert.equal(registry.dispatch({ action: "plan_open", planId, tasks: [{ id: "C" }] }).accepted, false);
});

test("sanitizes bounded task labels before Session persistence", () => {
	const { entries, registry } = createHarness();
	assert.equal(
		registry.dispatch({
			action: "plan_open",
			tasks: [{ id: "A", label: "safe\n\u001b]8;;file:///private\u0007label" }],
		}).accepted,
		true,
	);
	const persistedLabel = entries[0].payload.tasks[0].label;
	assert.equal(typeof persistedLabel, "string");
	assert.ok(persistedLabel.length <= 120);
	assert.doesNotMatch(persistedLabel, /[\u0000-\u001f\u007f-\u009f]/);
});

test("applies only legal task transitions and keeps duplicate transitions idempotent", () => {
	const { entries, registry } = createHarness();
	const planId = sealAndStart(registry);
	const startedEntries = entries.length;
	assert.equal(registry.dispatch({ action: "task_start", planId, taskId: "A" }).accepted, true);
	assert.equal(entries.length, startedEntries);
	assert.equal(registry.dispatch({ action: "task_start", planId, taskId: "B" }).accepted, false);
	assert.equal(
		registry.dispatch({ action: "task_finish", planId, taskId: "B", outcome: "completed" }).accepted,
		false,
	);
	assert.equal(registry.dispatch({ action: "task_finish", planId, taskId: "A", outcome: "blocked" }).accepted, true);
	assert.equal(registry.dispatch({ action: "task_resume", planId, taskId: "A" }).accepted, true);
	assert.equal(registry.dispatch({ action: "task_finish", planId, taskId: "A", outcome: "completed" }).accepted, true);
	assert.equal(registry.dispatch({ action: "task_resume", planId, taskId: "A" }).accepted, false);
	assert.equal(registry.snapshot().plan.counts.completed, 1);
});

test("rejects stale plan and task identities without changing the snapshot", () => {
	const { registry } = createHarness();
	const planId = sealAndStart(registry);
	const before = registry.snapshot();
	for (const action of [
		{ action: "task_start", planId: "old-plan", taskId: "B" },
		{ action: "task_start", planId, taskId: "unknown" },
		{ action: "plan_seal", planId: "old-plan" },
	]) {
		assert.equal(registry.dispatch(action).accepted, false);
		assert.deepEqual(registry.snapshot(), before);
	}
});

test("publishes each accepted state change once and ignores duplicate or rejected transitions", () => {
	const published = [];
	const { registry } = createHarness();
	const subscription = registry.subscribe((snapshot) => published.push(snapshot));
	const planId = openPlan(registry);
	assert.equal(registry.dispatch({ action: "plan_seal", planId }).accepted, true);
	assert.equal(registry.dispatch({ action: "plan_seal", planId }).accepted, true);
	assert.equal(registry.dispatch({ action: "task_start", planId, taskId: "missing" }).accepted, false);
	assert.equal(published.length, 2);
	assert.equal(Object.isFrozen(published[0]), true);
	subscription.dispose();
	assert.equal(registry.dispatch({ action: "task_start", planId, taskId: "A" }).accepted, true);
	assert.equal(published.length, 2);
});

test("does not publish or commit a transition when Session append fails", () => {
	const published = [];
	const { registry } = createHarness({ appendError: true });
	registry.subscribe((snapshot) => published.push(snapshot));
	assert.throws(() => registry.dispatch({ action: "plan_open", tasks: [{ id: "A" }] }), /append failed/);
	assert.deepEqual(registry.snapshot(), { availability: "empty", generation: 0 });
	assert.deepEqual(published, []);
});

test("preserves an in-flight binding when observed-receipt append fails", () => {
	let failObservedAppend = true;
	const entries = [];
	const { registry } = createHarness({
		appendReceipt(receipt) {
			if (receipt.action === "tool_observed" && failObservedAppend) throw new Error("observed append failed");
			entries.push(structuredClone(receipt));
		},
	});
	const planId = sealAndStart(registry);
	assert.equal(
		registry.recordToolStart({ toolCallId: "call-1", toolCategory: "command", commandCategory: "test" }),
		true,
	);
	assert.throws(() => registry.recordToolEnd({ toolCallId: "call-1", outcome: "success" }), /append failed/);
	assert.equal(
		registry.dispatch({ action: "task_finish", planId, taskId: "A", outcome: "completed" }).accepted,
		false,
	);
	failObservedAppend = false;
	assert.equal(registry.recordToolEnd({ toolCallId: "call-1", outcome: "success" }), true);
	assert.equal(registry.dispatch({ action: "task_finish", planId, taskId: "A", outcome: "completed" }).accepted, true);
	assert.equal(entries.filter((entry) => entry.action === "tool_observed").length, 1);
});

test("replays accepted receipts exactly and treats identical duplicates as idempotent", () => {
	const source = createHarness();
	const planId = sealAndStart(source.registry);
	source.registry.dispatch({ action: "task_finish", planId, taskId: "A", outcome: "completed" });
	const restored = createHarness();
	assert.equal(restored.registry.replay([...source.entries, structuredClone(source.entries.at(-1))]).accepted, true);
	assert.deepEqual(restored.registry.snapshot(), source.registry.snapshot());
	assert.deepEqual(restored.entries, []);
});

test("fails a damaged replay generation closed until an explicit new plan", () => {
	const source = createHarness();
	sealAndStart(source.registry);
	const damaged = source.entries.map((entry) => structuredClone(entry));
	damaged[1].sequence += 1;
	const restored = createHarness();
	assert.equal(restored.registry.replay(damaged).accepted, false);
	assert.deepEqual(restored.registry.snapshot(), {
		availability: "unavailable",
		generation: 1,
		reasonCode: "invalid_record",
	});
	const planId = openPlan(restored.registry, [{ id: "new" }]);
	assert.equal(planId, "plan-2");
	assert.equal(restored.registry.snapshot().availability, "available");
	const recovered = createHarness();
	assert.equal(recovered.registry.replay([...damaged, ...restored.entries]).accepted, true);
	assert.deepEqual(recovered.registry.snapshot(), restored.registry.snapshot());
});

test("does not let a rejected maximum sequence permanently poison explicit recovery", () => {
	const hostile = [
		{
			schemaVersion: 1,
			sequence: Number.MAX_SAFE_INTEGER,
			generation: 1,
			planId: "plan-1",
			action: "unknown_action",
			payload: {},
		},
	];
	const restored = createHarness();
	assert.equal(restored.registry.replay(hostile).accepted, false);
	assert.deepEqual(restored.registry.snapshot(), {
		availability: "unavailable",
		generation: 1,
		reasonCode: "invalid_record",
	});
	const planId = openPlan(restored.registry, [{ id: "new" }]);
	assert.equal(planId, "plan-2");
	assert.deepEqual(
		restored.entries.map((entry) => entry.sequence),
		[1],
	);
	const reloaded = createHarness();
	assert.equal(reloaded.registry.replay([...hostile, ...restored.entries]).accepted, true);
	assert.deepEqual(reloaded.registry.snapshot(), restored.registry.snapshot());
});

test("does not adopt a rejected hostile generation as the recovery baseline", () => {
	const hostile = [
		{
			schemaVersion: 1,
			sequence: 1,
			generation: Number.MAX_SAFE_INTEGER,
			planId: "plan-hostile",
			action: "unknown_action",
			payload: {},
		},
	];
	const restored = createHarness();
	assert.equal(restored.registry.replay(hostile).accepted, false);
	assert.deepEqual(restored.registry.snapshot(), {
		availability: "unavailable",
		generation: 0,
		reasonCode: "invalid_record",
	});
	assert.equal(openPlan(restored.registry, [{ id: "new" }]), "plan-1");
	const reloaded = createHarness();
	assert.equal(reloaded.registry.replay([...hostile, ...restored.entries]).accepted, true);
	assert.deepEqual(reloaded.registry.snapshot(), restored.registry.snapshot());
});

test("fails unsupported schema, invalid replayed tasks, and illegal replay transitions closed", () => {
	const source = createHarness();
	sealAndStart(source.registry);
	const variants = [
		(entries) => {
			entries[0].schemaVersion = 2;
		},
		(entries) => {
			entries[0].payload.tasks = [];
		},
		(entries) => {
			entries[0].payload.tasks = Array.from({ length: 65 }, (_, index) => ({ id: `task-${index}` }));
		},
		(entries) => {
			entries[0].payload.tasks = [{ id: "same" }, { id: "same" }];
		},
		(entries) => {
			entries[0].payload.tasks = [{ id: "contains space" }];
		},
		(entries) => {
			entries[0].payload.tasks = [{ id: "A", label: "x".repeat(121) }];
		},
		(entries) => {
			entries[1].planId = "unknown-plan";
		},
		(entries) => {
			entries[2].payload.taskId = "unknown-task";
		},
		(entries) => {
			entries[1].generation = 2;
		},
		(entries) => {
			entries[1].extra = "forged";
		},
		(entries) => {
			entries[2].action = "unknown_action";
		},
		(entries) => {
			entries[2].action = "task_finish";
			entries[2].payload = { taskId: "B", outcome: "completed" };
		},
	];
	for (const mutate of variants) {
		const entries = source.entries.map((entry) => structuredClone(entry));
		mutate(entries);
		entries.push({
			schemaVersion: 1,
			sequence: 4,
			generation: 1,
			planId: "plan-1",
			action: "task_finish",
			payload: { taskId: "A", outcome: "completed" },
		});
		const restored = createHarness();
		assert.equal(restored.registry.replay(entries).accepted, false);
		assert.deepEqual(restored.registry.snapshot(), {
			availability: "unavailable",
			generation: 1,
			reasonCode: "invalid_record",
		});
	}
});

test("fails cyclic, excessive, non-JSON, and unknown replay payloads closed without throwing", () => {
	const source = createHarness();
	sealAndStart(source.registry);
	const variants = [
		() => {
			const payload = {};
			payload.self = payload;
			return { action: "unknown_action", payload };
		},
		() => {
			let payload = {};
			for (let depth = 0; depth < 10; depth += 1) payload = { nested: payload };
			return { action: "unknown_action", payload };
		},
		() => ({ action: "unknown_action", payload: { value: 1n } }),
		() => ({ action: "unknown_action", payload: { values: Array.from({ length: 129 }, (_, index) => index) } }),
	];
	for (const createVariant of variants) {
		const entries = source.entries.map((entry) => structuredClone(entry));
		const variant = createVariant();
		entries.push({
			schemaVersion: 1,
			sequence: 4,
			generation: 1,
			planId: "plan-1",
			action: variant.action,
			payload: variant.payload,
		});
		const restored = createHarness();
		assert.doesNotThrow(() => restored.registry.replay(entries));
		assert.equal(restored.registry.snapshot().availability, "unavailable");
	}
});

test("fails a replayed 129th evidence receipt closed", () => {
	const source = createHarness();
	const planId = sealAndStart(source.registry);
	const entries = source.entries.map((entry) => structuredClone(entry));
	for (let index = 0; index < 129; index += 1) {
		entries.push({
			schemaVersion: 1,
			sequence: entries.length + 1,
			generation: 1,
			planId,
			action: "tool_observed",
			payload: { taskId: "A", toolCallId: `call-${index}`, category: "inspect", outcome: "success" },
		});
	}
	entries.push({
		schemaVersion: 1,
		sequence: entries.length + 1,
		generation: 1,
		planId,
		action: "task_finish",
		payload: { taskId: "A", outcome: "completed" },
	});
	const restored = createHarness();
	assert.equal(restored.registry.replay(entries).accepted, false);
	assert.deepEqual(restored.registry.snapshot(), {
		availability: "unavailable",
		generation: 1,
		reasonCode: "invalid_record",
	});
});

test("conflicting duplicates and forged later completion cannot repair replay", () => {
	const source = createHarness();
	const planId = sealAndStart(source.registry);
	const entries = source.entries.map((entry) => structuredClone(entry));
	const conflicting = structuredClone(entries.at(-1));
	conflicting.payload.taskId = "B";
	const forged = {
		schemaVersion: 1,
		sequence: conflicting.sequence + 1,
		generation: 1,
		planId,
		action: "task_finish",
		payload: { taskId: "A", outcome: "completed" },
	};
	const restored = createHarness();
	assert.equal(restored.registry.replay([...entries, conflicting, forged]).accepted, false);
	assert.equal(restored.registry.snapshot().availability, "unavailable");
});

test("Conversation, Pause, and Delivery-style consumers share one frozen fact source", () => {
	const { registry } = createHarness();
	const planId = sealAndStart(registry);
	const consumers = [
		{ name: "Conversation", read: (consumer) => consumer.snapshot() },
		{ name: "Pause", read: (consumer) => consumer.snapshot() },
		{ name: "Delivery", read: (consumer) => consumer.snapshot() },
	];
	const observed = consumers.map(({ name, read }) => {
		const snapshot = read(registry.consumer);
		assert.throws(
			() => {
				snapshot.plan.active.ordinal = 64;
			},
			TypeError,
			name,
		);
		assert.throws(
			() => {
				snapshot.plan.counts.completed = 64;
			},
			TypeError,
			name,
		);
		assert.equal("dispatch" in registry.consumer, false);
		assert.equal("tasks" in snapshot.plan, false);
		return snapshot;
	});
	assert.deepEqual(observed[0], observed[1]);
	assert.deepEqual(observed[1], observed[2]);
	assert.equal(registry.snapshot().plan.active.ordinal, 1);
	assert.equal(registry.snapshot().plan.counts.completed, 0);
	assert.equal(registry.dispatch({ action: "task_finish", planId, taskId: "A", outcome: "completed" }).accepted, true);
	assert.equal(registry.snapshot().plan.counts.completed, 1);
});

test("returns deeply frozen plain snapshots and does not expose mutable internals", () => {
	const { registry } = createHarness();
	sealAndStart(registry);
	const snapshot = registry.snapshot();
	assert.equal(Object.getPrototypeOf(snapshot), Object.prototype);
	assert.equal(Object.isFrozen(snapshot), true);
	assert.equal(Object.isFrozen(snapshot.plan), true);
	assert.equal(Object.isFrozen(snapshot.plan.active), true);
	assert.equal(Object.isFrozen(snapshot.plan.counts), true);
	assert.throws(() => {
		snapshot.plan.counts.completed = 99;
	}, TypeError);
	assert.equal(registry.snapshot().plan.counts.completed, 0);
	assert.equal("tasks" in snapshot.plan, false);
	assert.equal("receipts" in snapshot, false);
});
