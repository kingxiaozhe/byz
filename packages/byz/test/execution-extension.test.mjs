import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createPiExtensionPorts } from "../.byz-output/current/dist/adapters/pi/pi-runtime-adapter.js";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	SessionManager,
	SettingsManager,
} from "../.byz-output/current/dist/runtime/bundle/index.js";
import { createConversationExtension } from "../src/conversation/conversation-extension.js";
import { createExecutionExtension } from "../src/execution/execution-extension.js";
import { createExecutionRegistry } from "../src/execution/execution-registry.js";

function createHarness(options = {}) {
	const entries = [];
	const handlers = new Map();
	let tool;
	let planNumber = 0;
	const ports = {
		appendEntry(receipt) {
			entries.push(structuredClone(receipt));
		},
		on(name, handler) {
			handlers.set(name, handler);
			return { dispose() {} };
		},
		registerTool(execute) {
			tool = execute;
		},
	};
	const registry = createExecutionRegistry({
		appendReceipt: options.appendReceipt ?? ((receipt) => ports.appendEntry(receipt)),
		createPlanId: () => `plan-${++planNumber}`,
		verifyReceipt: options.verifyReceipt,
	});
	createExecutionExtension({ registry })(ports);
	return { entries, getTool: () => tool, handlers, ports, registry };
}

async function createActivePlan(harness, tasks = [{ id: "A" }, { id: "B" }]) {
	const open = await harness.getTool()({ action: "plan_open", tasks });
	assert.equal(open.accepted, true);
	assert.equal((await harness.getTool()({ action: "plan_seal", planId: open.planId })).accepted, true);
	assert.equal(
		(await harness.getTool()({ action: "task_start", planId: open.planId, taskId: tasks[0].id })).accepted,
		true,
	);
	return open.planId;
}

test("registers one closed execution tool and returns only bounded results", async () => {
	const harness = createHarness();
	assert.equal(typeof harness.getTool(), "function");
	const open = await harness.getTool()({
		action: "plan_open",
		tasks: [{ id: "A", label: "private /Users/name command" }],
	});
	assert.deepEqual(open, {
		accepted: true,
		planId: "plan-1",
		counts: {
			blocked: 0,
			cancelled: 0,
			completed: 0,
			declaredEvidence: 0,
			observedEvidence: 0,
			verifiedEvidence: 0,
			verifiedFailedEvidence: 0,
			verifiedPassedEvidence: 0,
		},
	});
	assert.doesNotMatch(JSON.stringify(open), /private|Users|command/);
	const bad = await harness.getTool()({ action: "task_start", planId: open.planId, taskId: "missing" });
	assert.deepEqual(bad, { accepted: false, errorCode: "plan_not_sealed" });
});

test("rejects unknown managed actions and extra fields on every transition", async () => {
	const harness = createHarness();
	assert.equal((await harness.getTool()({ action: "unknown" })).accepted, false);
	const open = await harness.getTool()({ action: "plan_open", tasks: [{ id: "A" }] });
	assert.equal(open.accepted, true);
	assert.equal(
		(await harness.getTool()({ action: "plan_seal", planId: open.planId, extra: "forged" })).accepted,
		false,
	);
	assert.equal((await harness.getTool()({ action: "plan_seal", planId: open.planId })).accepted, true);
	assert.equal(
		(await harness.getTool()({ action: "task_start", planId: open.planId, taskId: "A", extra: "forged" })).accepted,
		false,
	);
	assert.equal((await harness.getTool()({ action: "task_start", planId: open.planId, taskId: "A" })).accepted, true);
	assert.equal(
		(
			await harness.getTool()({
				action: "task_finish",
				planId: open.planId,
				taskId: "A",
				outcome: "blocked",
				extra: "forged",
			})
		).accepted,
		false,
	);
	assert.equal(
		(
			await harness.getTool()({
				action: "task_finish",
				planId: open.planId,
				taskId: "A",
				outcome: "blocked",
			})
		).accepted,
		true,
	);
	assert.equal(
		(await harness.getTool()({ action: "task_resume", planId: open.planId, taskId: "A", extra: "forged" })).accepted,
		false,
	);
	assert.equal((await harness.getTool()({ action: "task_resume", planId: open.planId, taskId: "A" })).accepted, true);
	assert.equal(
		(
			await harness.getTool()({
				action: "evidence_add",
				planId: open.planId,
				taskId: "A",
				kind: "tests_passed",
				basis: "latest_observed",
				extra: "forged",
			})
		).accepted,
		false,
	);
	assert.equal(
		(
			await harness.getTool()({
				action: "evidence_add",
				planId: open.planId,
				taskId: "A",
				kind: "tests_passed",
				basis: "latest_observed",
			})
		).accepted,
		true,
	);
	assert.deepEqual(
		{
			completed: harness.registry.snapshot().plan.counts.completed,
			declaredEvidence: harness.registry.snapshot().plan.counts.declaredEvidence,
		},
		{ completed: 0, declaredEvidence: 1 },
	);
});

test("binds parallel observed tools to the active task and pairs them once", async () => {
	const harness = createHarness();
	const planId = await createActivePlan(harness);
	await harness.handlers.get("tool_execution_start")({
		toolCallId: "X",
		toolCategory: "inspect",
		commandCategory: "generic",
	});
	await harness.handlers.get("tool_execution_start")({
		toolCallId: "Y",
		toolCategory: "command",
		commandCategory: "test",
	});
	const beforeBlockedFinish = harness.registry.snapshot();
	assert.equal(
		(
			await harness.getTool()({
				action: "task_finish",
				planId,
				taskId: "A",
				outcome: "completed",
			})
		).accepted,
		false,
	);
	assert.deepEqual(harness.registry.snapshot(), beforeBlockedFinish);
	await harness.handlers.get("tool_execution_end")({ toolCallId: "Y", outcome: "success" });
	await harness.handlers.get("tool_execution_end")({ toolCallId: "X", outcome: "failure" });
	await harness.handlers.get("tool_execution_end")({ toolCallId: "Y", outcome: "success" });
	await harness.handlers.get("tool_execution_end")({ toolCallId: "unknown", outcome: "failure" });
	const observed = harness.entries.filter((entry) => entry.action === "tool_observed");
	assert.equal(observed.length, 2);
	assert.deepEqual(
		observed.map((entry) => ({
			taskId: entry.payload.taskId,
			category: entry.payload.category,
			outcome: entry.payload.outcome,
		})),
		[
			{ taskId: "A", category: "test", outcome: "success" },
			{ taskId: "A", category: "inspect", outcome: "failure" },
		],
	);
	assert.equal(harness.registry.snapshot().plan.counts.observedEvidence, 2);
});

test("does not let categorized command success or model declarations become verified", async () => {
	const harness = createHarness();
	const planId = await createActivePlan(harness);
	for (const event of [
		{ toolCallId: "generic-1", commandCategory: "generic", outcome: "success" },
		{ toolCallId: "test-1", commandCategory: "test", outcome: "success" },
		{ toolCallId: "check-1", commandCategory: "check", outcome: "failure" },
	]) {
		await harness.handlers.get("tool_execution_start")({
			toolCallId: event.toolCallId,
			toolCategory: "command",
			commandCategory: event.commandCategory,
		});
		await harness.handlers.get("tool_execution_end")({ toolCallId: event.toolCallId, outcome: event.outcome });
	}
	const declared = await harness.getTool()({
		action: "evidence_add",
		planId,
		taskId: "A",
		kind: "tests_passed",
		basis: "latest_observed",
	});
	assert.equal(declared.accepted, true);
	assert.deepEqual(harness.registry.snapshot().plan.counts, {
		blocked: 0,
		cancelled: 0,
		completed: 0,
		declaredEvidence: 1,
		observedEvidence: 3,
		verifiedEvidence: 0,
		verifiedFailedEvidence: 0,
		verifiedPassedEvidence: 0,
	});
	assert.deepEqual(
		harness.entries
			.filter((entry) => entry.action === "tool_observed")
			.map((entry) => ({ category: entry.payload.category, outcome: entry.payload.outcome })),
		[
			{ category: "generic", outcome: "success" },
			{ category: "test", outcome: "success" },
			{ category: "check", outcome: "failure" },
		],
	);
});

test("accepts verified evidence only through a fully bound trusted verifier", async () => {
	const harness = createHarness({
		verifyReceipt: (receipt) =>
			receipt.source === "cm-workflow" && receipt.testCaseId === "TC-003" && receipt.outcome === "passed",
	});
	const planId = await createActivePlan(harness);
	assert.equal(
		harness.registry.recordVerifiedEvidence({
			source: "model",
			generation: 1,
			planId,
			taskId: "A",
			testCaseId: "TC-003",
			outcome: "passed",
		}).accepted,
		false,
	);
	assert.equal(
		harness.registry.recordVerifiedEvidence({
			source: "cm-workflow",
			generation: 99,
			planId,
			taskId: "A",
			testCaseId: "TC-003",
			outcome: "passed",
		}).accepted,
		false,
	);
	for (const receipt of [
		{
			source: "cm-workflow",
			generation: 1,
			planId,
			taskId: "missing",
			testCaseId: "TC-003",
			outcome: "passed",
		},
		{
			source: "cm-workflow",
			generation: 1,
			planId,
			taskId: "A",
			testCaseId: "invalid case",
			outcome: "passed",
		},
		{
			source: "cm-workflow",
			generation: 1,
			planId,
			taskId: "A",
			testCaseId: "TC-003",
			outcome: "passed",
			extra: "forged",
		},
	]) {
		assert.equal(harness.registry.recordVerifiedEvidence(receipt).accepted, false);
	}
	assert.equal(
		harness.registry.recordVerifiedEvidence({
			source: "cm-workflow",
			generation: 1,
			planId,
			taskId: "A",
			testCaseId: "TC-003",
			outcome: "passed",
		}).accepted,
		true,
	);
	assert.equal(
		harness.registry.recordVerifiedEvidence({
			source: "cm-workflow",
			generation: 1,
			planId,
			taskId: "A",
			testCaseId: "TC-003",
			outcome: "passed",
			category: "test",
		}).accepted,
		true,
	);
	assert.equal(harness.registry.snapshot().plan.counts.verifiedEvidence, 2);
	assert.deepEqual(harness.registry.snapshot().plan.counts.verifiedPassedCategories, ["test"]);
});

test("rejects malformed tool-call identities before pairing or persistence", async () => {
	const harness = createHarness();
	await createActivePlan(harness);
	const entriesBefore = harness.entries.length;
	for (const toolCallId of ["", "/Users/private", "line\nbreak", "x".repeat(65)]) {
		await harness.handlers.get("tool_execution_start")({
			toolCallId,
			toolCategory: "inspect",
			commandCategory: "generic",
		});
		await harness.handlers.get("tool_execution_end")({ toolCallId, outcome: "success" });
	}
	assert.equal(harness.entries.length, entriesBefore);
	assert.equal(harness.registry.snapshot().plan.counts.observedEvidence, 0);
	assert.doesNotMatch(JSON.stringify(harness.entries), /Users|private|line|break/);
	const boundedId = "x".repeat(64);
	await harness.handlers.get("tool_execution_start")({
		toolCallId: boundedId,
		toolCategory: "inspect",
		commandCategory: "generic",
	});
	await harness.handlers.get("tool_execution_end")({ toolCallId: boundedId, outcome: "success" });
	assert.equal(harness.registry.snapshot().plan.counts.observedEvidence, 1);
	assert.equal(harness.entries.at(-1).payload.toolCallId, boundedId);
});

test("bounds observed receipts and rejects receipt 129 without changing counts", async () => {
	const harness = createHarness();
	await createActivePlan(harness);
	for (let index = 0; index < 128; index += 1) {
		await harness.handlers.get("tool_execution_start")({
			toolCallId: `call-${index}`,
			toolCategory: "inspect",
			commandCategory: "generic",
		});
		await harness.handlers.get("tool_execution_end")({ toolCallId: `call-${index}`, outcome: "success" });
	}
	const entriesAtLimit = harness.entries.length;
	await harness.handlers.get("tool_execution_start")({
		toolCallId: "overflow",
		toolCategory: "inspect",
		commandCategory: "generic",
	});
	await harness.handlers.get("tool_execution_end")({ toolCallId: "overflow", outcome: "success" });
	assert.equal(harness.entries.length, entriesAtLimit);
	assert.equal(harness.registry.snapshot().plan.counts.observedEvidence, 128);
});

test("stores no raw command, arguments, result, path, or error text in observed receipts", async () => {
	const harness = createHarness();
	await createActivePlan(harness);
	await harness.handlers.get("tool_execution_start")({
		toolCallId: "safe-id",
		toolCategory: "command",
		commandCategory: "check",
		args: { command: "cat /private/file" },
	});
	await harness.handlers.get("tool_execution_end")({
		toolCallId: "safe-id",
		outcome: "failure",
		result: "private result",
		error: "private error",
	});
	const receipt = harness.entries.at(-1);
	assert.deepEqual(Object.keys(receipt.payload).sort(), ["category", "outcome", "taskId", "toolCallId"]);
	assert.doesNotMatch(JSON.stringify(receipt), /cat \/private|private|result|error|command|args/);
});

test("replays only projected execution entries on Session start", async () => {
	const source = createHarness();
	await createActivePlan(source);
	const restored = createHarness();
	let reads = 0;
	await restored.handlers.get("session_start")(
		{ type: "session_start", reason: "resume" },
		{
			readEntries() {
				reads += 1;
				return source.entries.map((entry) => structuredClone(entry));
			},
		},
	);
	assert.equal(reads, 1);
	assert.deepEqual(restored.registry.snapshot(), source.registry.snapshot());
	assert.deepEqual(restored.entries, []);
});

test("real AgentSession and faux provider execute a 64-task managed plan without network access", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "byz-execution-runtime-"));
	const agentDir = join(root, "agent");
	const faux = createFauxCore({ models: [{ id: "execution", name: "Execution" }], tokensPerSecond: 1000 });
	const workingMessages = [];
	const notifications = [];
	const sessionManager = SessionManager.inMemory();
	let session;
	let registry;
	let networkCalls = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		networkCalls += 1;
		throw new Error("unexpected network call");
	};
	t.after(async () => {
		globalThis.fetch = originalFetch;
		session?.dispose();
		await rm(root, { force: true, recursive: true });
	});
	await mkdir(agentDir, { recursive: true });
	await writeFile(join(agentDir, "auth.json"), JSON.stringify({ faux: { type: "api_key", key: "faux-key" } }));
	const model = faux.getModel("execution");
	const settingsManager = SettingsManager.inMemory();
	settingsManager.applyOverrides({ retry: { enabled: false } });
	const services = await createAgentSessionServices({
		agentDir,
		cwd: root,
		settingsManager,
		resourceLoaderOptions: {
			extensionFactories: [
				{
					name: "byz-execution-under-test",
					factory: (pi) => {
						pi.registerProvider(model.provider, {
							baseUrl: model.baseUrl,
							apiKey: "faux-key",
							api: faux.api,
							streamSimple: faux.streamSimple,
							models: faux.models.map((candidate) => ({
								id: candidate.id,
								name: candidate.name,
								api: candidate.api,
								reasoning: candidate.reasoning,
								input: candidate.input,
								cost: candidate.cost,
								contextWindow: candidate.contextWindow,
								maxTokens: candidate.maxTokens,
								baseUrl: candidate.baseUrl,
							})),
						});
						const ports = createPiExtensionPorts(pi);
						registry = createExecutionRegistry({
							appendReceipt: (receipt) => ports.execution.appendEntry(receipt),
							createPlanId: () => "plan-1",
						});
						createExecutionExtension({ registry })(ports.execution);
						createConversationExtension({
							executionRegistry: registry.consumer,
							progressCardDelayMs: 0,
							setTimeout(handler) {
								queueMicrotask(handler);
								return 1;
							},
							clearTimeout() {},
							setInterval: () => 1,
							clearInterval() {},
						})(ports.conversation);
					},
				},
			],
			noPromptTemplates: true,
			noSkills: true,
			noThemes: true,
		},
	});
	({ session } = await createAgentSessionFromServices({ services, sessionManager, model }));
	await session.bindExtensions({
		mode: "tui",
		uiContext: {
			select: async () => undefined,
			confirm: async () => false,
			input: async () => undefined,
			notify: (message) => notifications.push(message),
			onTerminalInput: () => () => {},
			setStatus() {},
			setWorkingMessage: (message) => workingMessages.push(message),
			setWorkingVisible() {},
			setWorkingIndicator() {},
			setHiddenThinkingLabel() {},
			setWidget() {},
			setFooter() {},
			setHeader() {},
			setTitle() {},
			setMessagePresenter() {},
			setToolExecutionVisible() {},
			setConfirmationPresenter() {},
			custom: async () => undefined,
		},
	});
	const tasks = Array.from({ length: 64 }, (_, index) => ({ id: `task-${index + 1}` }));
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("byz_execution", { action: "plan_open", tasks }), { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxToolCall("byz_execution", { action: "plan_seal", planId: "plan-1" }), {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage(
			fauxToolCall("byz_execution", { action: "task_start", planId: "plan-1", taskId: "task-64" }),
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage("done"),
	]);
	await session.prompt("execute a private 64-step plan");
	assert.equal(networkCalls, 0);
	assert.equal(registry.snapshot().plan.active.ordinal, 64);
	const stepLines = workingMessages.filter((message) => /Step 64\/64/.test(message ?? ""));
	assert.ok(stepLines.length > 0);
	assert.equal(
		stepLines.every((message) => message.length <= 80 && !message.includes("\n")),
		true,
	);
	assert.match(notifications.at(-1), /completed 0\/64/);
	const receipts = sessionManager
		.getEntries()
		.filter((entry) => entry.type === "custom" && entry.customType === "byz.execution.v1");
	assert.equal(receipts.length, 3);
	assert.doesNotMatch(JSON.stringify(receipts), /private|execute a private|tool result|response/);
});

test("agent, cancellation, error, compaction, reload, and shutdown persist bounded in-flight closure", async () => {
	for (const scenario of [
		{ event: "agent_end", reason: "normal", toolCallId: "lifecycle-1" },
		{ event: "agent_end", reason: "cancelled", toolCallId: "lifecycle-2" },
		{ event: "agent_end", reason: "error", toolCallId: "lifecycle-3" },
		{ event: "session_before_compact", reason: "overflow", toolCallId: "lifecycle-4" },
		{ event: "session_shutdown", reason: "shutdown", toolCallId: "lifecycle-5" },
	]) {
		const harness = createHarness();
		const planId = await createActivePlan(harness);
		const toolCallId = scenario.toolCallId;
		await harness.handlers.get("tool_execution_start")({
			toolCallId,
			toolCategory: "inspect",
			commandCategory: "generic",
		});
		await harness.handlers.get(scenario.event)({ type: scenario.event, reason: scenario.reason });
		await harness.handlers.get(scenario.event)({ type: scenario.event, reason: scenario.reason });
		assert.deepEqual(harness.registry.snapshot().plan.active, { id: "A", ordinal: 1 });
		assert.equal(harness.registry.snapshot().plan.counts.completed, 0);
		assert.equal(harness.registry.snapshot().plan.counts.observedEvidence, 1);
		assert.deepEqual(harness.entries.at(-1).payload, {
			taskId: "A",
			toolCallId,
			category: "inspect",
			outcome: "failure",
		});
		assert.doesNotMatch(JSON.stringify(harness.entries.at(-1)), /normal|cancelled|overflow|shutdown|error/);
		assert.equal(
			(
				await harness.getTool()({
					action: "task_finish",
					planId,
					taskId: "A",
					outcome: "completed",
				})
			).accepted,
			true,
		);
	}
	const reloaded = createHarness();
	const planId = await createActivePlan(reloaded);
	await reloaded.handlers.get("tool_execution_start")({
		toolCallId: "in-flight-reload",
		toolCategory: "inspect",
		commandCategory: "generic",
	});
	await reloaded.handlers.get("session_before_switch")({ type: "session_before_switch", reason: "reload" });
	const beforeReload = reloaded.registry.snapshot();
	await reloaded.handlers.get("session_start")(
		{ type: "session_start", reason: "reload" },
		{ readEntries: () => reloaded.entries.map((entry) => structuredClone(entry)) },
	);
	assert.deepEqual(reloaded.registry.snapshot(), beforeReload);
	assert.equal(beforeReload.plan.counts.observedEvidence, 1);
	assert.equal(
		(
			await reloaded.getTool()({
				action: "task_finish",
				planId,
				taskId: "A",
				outcome: "completed",
			})
		).accepted,
		true,
	);
});

test("lifecycle closure preserves the binding when Session append fails and retries once", async () => {
	let failObservedAppend = true;
	const entries = [];
	const harness = createHarness({
		appendReceipt(receipt) {
			if (receipt.action === "tool_observed" && failObservedAppend) throw new Error("append failed");
			entries.push(structuredClone(receipt));
		},
	});
	const planId = await createActivePlan(harness);
	await harness.handlers.get("tool_execution_start")({
		toolCallId: "in-flight-append",
		toolCategory: "inspect",
		commandCategory: "generic",
	});
	await harness.handlers.get("agent_end")({ type: "agent_end" });
	assert.equal(harness.registry.snapshot().plan.counts.observedEvidence, 0);
	assert.equal(
		(await harness.getTool()({ action: "task_finish", planId, taskId: "A", outcome: "completed" })).accepted,
		false,
	);
	failObservedAppend = false;
	await harness.handlers.get("agent_end")({ type: "agent_end" });
	await harness.handlers.get("agent_end")({ type: "agent_end" });
	assert.equal(harness.registry.snapshot().plan.counts.observedEvidence, 1);
	assert.equal(entries.filter((entry) => entry.action === "tool_observed").length, 1);
	assert.equal(
		(await harness.getTool()({ action: "task_finish", planId, taskId: "A", outcome: "completed" })).accepted,
		true,
	);
});
