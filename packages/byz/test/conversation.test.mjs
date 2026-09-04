import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
import { createConversationExtension, WELCOME } from "../src/conversation/conversation-extension.js";
import {
	createInteractionPolicy,
	formatDecision,
	parseConversationControl,
} from "../src/conversation/interaction-policy.js";
import { createProgressState, summarizeGoal } from "../src/conversation/progress-projector.js";
import { classifyRequest, createRoutingPolicy, parseSessionPreference } from "../src/conversation/routing-policy.js";
import { createTurnTiming, formatElapsed } from "../src/conversation/turn-timing.js";
import { createPauseController } from "../src/execution/pause-controller.js";

function fauxProviderConfig(faux) {
	const model = faux.getModel();
	return {
		baseUrl: model.baseUrl,
		apiKey: "faux-key",
		api: faux.api,
		streamSimple: faux.streamSimple,
		models: faux.models.map((registeredModel) => ({
			id: registeredModel.id,
			name: registeredModel.name,
			api: registeredModel.api,
			reasoning: registeredModel.reasoning,
			input: registeredModel.input,
			cost: registeredModel.cost,
			contextWindow: registeredModel.contextWindow,
			maxTokens: registeredModel.maxTokens,
			baseUrl: registeredModel.baseUrl,
		})),
	};
}

function createConversationHarness(options = {}) {
	const handlers = new Map();
	const commands = new Map();
	const notifications = [];
	const workingMessages = [];
	let confirmationPresenter;
	createConversationExtension({ setInterval: () => 1, clearInterval() {}, ...options })({
		on: (name, handler) => handlers.set(name, handler),
		registerCommand: (name, command) => commands.set(name, command),
	});
	const ctx = {
		ui: {
			notify: (message) => notifications.push(message),
			input: async () => undefined,
			setTitle() {},
			setMessagePresenter() {},
			setToolExecutionVisible() {},
			setFooter() {},
			setConfirmationPresenter(presenter) {
				confirmationPresenter = presenter;
			},
			setWorkingMessage: (message) => workingMessages.push(message),
		},
	};
	return {
		commands,
		ctx,
		getConfirmationPresenter: () => confirmationPresenter,
		handlers,
		notifications,
		workingMessages,
	};
}

test("maps structural conversation states to readable, low-noise output", () => {
	const policy = createInteractionPolicy();
	assert.equal(policy.present("result", "完成：已整理重点。"), "完成：已整理重点。");
	assert.equal(policy.present("progress", "tool step 1"), "正在处理，稍后给你结果。");
	assert.equal(policy.present("progress", "tool step 2"), undefined);
	assert.equal(policy.present("failure", "无法继续：需要你的决定。"), "无法继续：需要你的决定。");
	assert.equal(policy.present("advanced-control", "Fast"), undefined);
	assert.deepEqual(
		policy.presentAssistantMessage({ content: [{ type: "toolCall", name: "read" }], role: "assistant" }),
		{ content: [], role: "assistant" },
	);
	assert.deepEqual(
		policy.presentAssistantMessage({ content: [{ type: "text", text: "model step 1 complete" }], role: "assistant" }),
		{ content: [{ type: "text", text: "model step 1 complete" }], role: "assistant" },
	);
	policy.setDetailEnabled(true);
	assert.equal(policy.present("advanced-control", "Fast"), "Fast");
});

test("conversation lifecycle, controller, projectors, presenters, footer, and language catalog are separated", async () => {
	const directory = new URL("../src/conversation/", import.meta.url);
	for (const file of [
		"conversation-controller.js",
		"progress-projector.js",
		"conversation-presenter.js",
		"confirmation-presenter.js",
		"footer-presenter.js",
		"language-catalog.js",
	]) {
		await readFile(new URL(file, directory), "utf8");
	}
	const extension = await readFile(new URL("conversation-extension.js", directory), "utf8");
	const controller = await readFile(new URL("conversation-controller.js", directory), "utf8");
	const policy = await readFile(new URL("interaction-policy.js", directory), "utf8");
	assert.doesNotMatch(extension, /node:fs/);
	assert.match(extension, /ports\.on\("tool_execution_start"/);
	assert.match(extension, /ports\.registerCommand\("details"/);
	assert.doesNotMatch(controller, /\bports\b|registerCommand/);
	assert.doesNotMatch(policy, /INTERNAL_TERMS|\.replace\(/);
});

test("conversation extension delegates registered lifecycle handlers to the controller API", () => {
	const handlers = Object.fromEntries(
		[
			"onAgentEnd",
			"onAgentSettled",
			"onAgentStart",
			"onBeforeAgentStart",
			"onMessageEnd",
			"onMessageUpdate",
			"onSessionShutdown",
			"onSessionStart",
			"onThinkingLevelSelect",
			"onToolExecutionEnd",
			"onToolExecutionStart",
		].map((name) => [name, () => name]),
	);
	handlers.handleDetailsCommand = () => "details";
	handlers.handleLanguageCommand = () => "language";
	const events = new Map();
	const commands = new Map();
	createConversationExtension({ controllerFactory: () => handlers })({
		on: (name, handler) => events.set(name, handler),
		registerCommand: (name, command) => commands.set(name, command),
	});
	assert.equal(events.get("session_start"), handlers.onSessionStart);
	assert.equal(events.get("before_agent_start"), handlers.onBeforeAgentStart);
	assert.equal(events.get("tool_execution_start"), handlers.onToolExecutionStart);
	assert.equal(events.get("session_shutdown"), handlers.onSessionShutdown);
	assert.equal(commands.get("details").handler instanceof Function, true);
	assert.equal(commands.get("language").handler instanceof Function, true);
});

test("progress projector defaults are valid without controller-provided language", () => {
	assert.equal(createProgressState().language, "zh");
	assert.equal(summarizeGoal(""), "当前任务");
});

test("recognizes natural language detail and decision choices", () => {
	assert.equal(parseConversationControl("展开细节"), "detail");
	assert.equal(parseConversationControl("确认"), "accept");
	assert.equal(parseConversationControl("取消"), "reject");
	assert.equal(parseConversationControl("普通任务"), undefined);
	assert.match(
		formatDecision({
			impact: "将发布内容",
			recommendation: "建议继续",
			alternative: "先保存草稿",
			onReject: "不会发布",
		}),
		/影响：将发布内容[\s\S]*建议：建议继续[\s\S]*其他选择：先保存草稿[\s\S]*如果拒绝：不会发布/,
	);
});

test("classifies common request shapes with deterministic local rules", () => {
	assert.equal(classifyRequest("查一下 https://example.com 这个链接").kind, "research");
	assert.equal(classifyRequest("先给三个方向，帮我写产品文案").kind, "creative");
	assert.equal(classifyRequest("修复这个可复现 bug，启动时报错").kind, "bug-fix");
	assert.equal(classifyRequest("增加一个新功能，导出报告").kind, "feature");
	assert.equal(classifyRequest("恢复上次停下的项目进度").kind, "project-recovery");
	assert.equal(classifyRequest("你好").kind, "general");
});

test("parses session preference controls without discarding the user goal", () => {
	assert.deepEqual(parseSessionPreference("直接做，先给三个方向，写一个发布方案"), {
		details: false,
		goal: "写一个发布方案",
		preferences: { autonomy: "direct", delivery: "three-directions" },
	});
	assert.deepEqual(parseSessionPreference("关键动作先问我；展开细节；修复启动报错"), {
		details: true,
		goal: "修复启动报错",
		preferences: { autonomy: "confirm-key-actions" },
	});
});

test("routing policy keeps preferences in memory and resets to defaults", () => {
	const policy = createRoutingPolicy();
	const first = policy.route("少问一点，查一下这个链接");
	assert.equal(first.kind, "research");
	assert.equal(first.preferences.autonomy, "fewer-questions");
	assert.match(first.instructions, /仅在缺少会明显改变结果/);
	assert.match(first.missingInput, /链接/);
	const second = policy.route("普通任务");
	assert.equal(second.preferences.autonomy, "fewer-questions");
	policy.reset();
	assert.equal(policy.route("普通任务").preferences.autonomy, "balanced");
});

test("turn timing uses a monotonic clock and separates active stages from confirmation wait", () => {
	let now = 0;
	const timing = createTurnTiming({ now: () => now });
	timing.start("goal");
	now = 2_000;
	timing.transition("inspect");
	now = 5_000;
	timing.pauseForConfirmation();
	now = 10_000;
	timing.resumeAfterConfirmation();
	now = 12_000;
	assert.equal(timing.pause("pause"), true);
	now = 20_000;
	assert.equal(timing.resume("pause"), true);
	timing.transition("command");
	now = 21_000;
	timing.transition("inspect");
	now = 23_000;
	const result = timing.finish();
	assert.deepEqual(result.stages, [
		{ stage: "goal", milliseconds: 2_000 },
		{ stage: "inspect", milliseconds: 7_000 },
		{ stage: "command", milliseconds: 1_000 },
	]);
	assert.equal(result.activeMs, 10_000);
	assert.equal(result.confirmationWaitingMs, 5_000);
	assert.equal(result.pauseWaitingMs, 8_000);
	assert.equal(result.waitingMs, 13_000);
	assert.equal(result.totalMs, 23_000);
	assert.equal(timing.finish(), result);
	assert.equal(formatElapsed(187_999), "3分07秒");
	assert.equal(formatElapsed(187_999, "en"), "3m 07s");
});

test("compact execution status waits two seconds and uses an observed turn token headline", async (t) => {
	const originalSetTimeout = globalThis.setTimeout;
	const originalClearTimeout = globalThis.clearTimeout;
	let now = 0;
	let revealProgress;
	let tick;
	let timeoutDelay;
	let timeoutClears = 0;
	globalThis.setTimeout = (handler, delay) => {
		revealProgress = handler;
		timeoutDelay = delay;
		return 2;
	};
	globalThis.clearTimeout = () => {
		timeoutClears++;
		revealProgress = undefined;
	};
	t.after(() => {
		globalThis.setTimeout = originalSetTimeout;
		globalThis.clearTimeout = originalClearTimeout;
	});
	const harness = createConversationHarness({
		now: () => now,
		setInterval(handler) {
			tick = handler;
			return 1;
		},
		clearInterval() {},
	});
	await harness.handlers.get("session_start")({}, harness.ctx);
	await harness.handlers.get("before_agent_start")({ prompt: "检查执行状态", systemPrompt: "base" }, harness.ctx);
	await harness.handlers.get("agent_start")({}, harness.ctx);
	assert.equal(timeoutDelay, 2_000);
	assert.deepEqual(harness.workingMessages, []);
	now = 1_999;
	tick();
	assert.deepEqual(harness.workingMessages, []);
	now = 2_000;
	const revealLongTurn = revealProgress;
	revealProgress = undefined;
	revealLongTurn();
	assert.match(harness.workingMessages.at(-1), /^BYZ 思考中 · 0分02秒 · Token —$/);
	await harness.handlers.get("message_update")(
		{ message: { role: "assistant", usage: { input: 120, output: 8, cacheRead: 40 } } },
		harness.ctx,
	);
	assert.match(harness.workingMessages.at(-1), /Token 128$/);
	assert.doesNotMatch(harness.workingMessages.at(-1), /40|缓存|cache/);
	await harness.handlers.get("agent_end")({ usage: { input: 120, output: 8, cacheRead: 40 } }, harness.ctx);

	const shortTurnStart = harness.workingMessages.length;
	await harness.handlers.get("before_agent_start")({ prompt: "短任务", systemPrompt: "base" }, harness.ctx);
	await harness.handlers.get("agent_start")({}, harness.ctx);
	const staleShortTurnReveal = revealProgress;
	now = 2_100;
	await harness.handlers.get("agent_end")({}, harness.ctx);
	assert.equal(timeoutClears, 1);
	assert.equal(
		harness.workingMessages.slice(shortTurnStart).some((message) => message !== undefined),
		false,
	);
	const thirdTurnStart = harness.workingMessages.length;
	await harness.handlers.get("before_agent_start")({ prompt: "第三轮", systemPrompt: "base" }, harness.ctx);
	await harness.handlers.get("agent_start")({}, harness.ctx);
	const thirdTurnReveal = revealProgress;
	staleShortTurnReveal();
	assert.equal(
		harness.workingMessages.slice(thirdTurnStart).some((message) => message !== undefined),
		false,
	);
	now = 4_100;
	thirdTurnReveal();
	assert.match(harness.workingMessages.at(-1), /^BYZ 思考中 · 0分02秒 · Token —$/);
	await harness.handlers.get("agent_end")({}, harness.ctx);
});

test("parallel tools stay paired while assistant and malformed tool events interleave", async () => {
	const harness = createConversationHarness({ progressCardDelayMs: 0 });
	await harness.handlers.get("session_start")({}, harness.ctx);
	await harness.handlers.get("before_agent_start")({ prompt: "并行核对", systemPrompt: "base" }, harness.ctx);
	await harness.handlers.get("agent_start")({}, harness.ctx);
	await new Promise((resolve) => setTimeout(resolve, 5));
	await harness.handlers.get("tool_execution_start")({ toolCallId: "A", toolName: "read" }, harness.ctx);
	await harness.handlers.get("tool_execution_start")({ toolCallId: "B", toolName: "bash" }, harness.ctx);
	assert.match(harness.workingMessages.at(-1), /2 个工具运行/);
	await harness.handlers.get("message_update")({ message: { role: "assistant" } }, harness.ctx);
	assert.match(harness.workingMessages.at(-1), /2 个工具运行/);
	await harness.handlers.get("tool_execution_start")({ toolName: "edit" }, harness.ctx);
	await harness.handlers.get("tool_execution_end")({ toolName: "edit", isError: true }, harness.ctx);
	assert.match(harness.workingMessages.at(-1), /2 个工具运行/);
	await harness.handlers.get("tool_execution_end")(
		{ toolCallId: "A", toolName: "read", args: { path: "/private/a" }, isError: true },
		harness.ctx,
	);
	assert.match(harness.workingMessages.at(-1), /1 个工具运行/);
	await harness.handlers.get("message_update")({ message: { role: "assistant" } }, harness.ctx);
	assert.match(harness.workingMessages.at(-1), /1 个工具运行/);
	await harness.handlers.get("tool_execution_end")({ toolCallId: "A", toolName: "read", isError: false }, harness.ctx);
	await harness.handlers.get("tool_execution_end")(
		{ toolCallId: "unknown", toolName: "write", isError: true },
		harness.ctx,
	);
	assert.match(harness.workingMessages.at(-1), /1 个工具运行/);
	await harness.handlers.get("tool_execution_end")(
		{ toolCallId: "B", toolName: "bash", args: { command: "false" }, isError: false },
		harness.ctx,
	);
	assert.match(harness.workingMessages.at(-1), /处理异常/);
	assert.doesNotMatch(harness.workingMessages.at(-1), /工具运行/);
	await harness.handlers.get("agent_end")({}, harness.ctx);
	const summary = harness.notifications.at(-1);
	assert.equal(summary.split("\n").length, 2);
	assert.match(summary, /工具 2 次（1 次失败）/);
	assert.doesNotMatch(summary, /\/private\/a|false/);
});

test("BYZ model-active summary excludes tool execution and confirmation waiting", async () => {
	let now = 0;
	const harness = createConversationHarness({
		now: () => now,
		progressCardDelayMs: 0,
		setInterval: () => 1,
		clearInterval() {},
	});
	await harness.handlers.get("session_start")({}, harness.ctx);
	await harness.handlers.get("before_agent_start")({ prompt: "分账计时", systemPrompt: "base" }, harness.ctx);
	await harness.handlers.get("agent_start")({}, harness.ctx);
	now = 3_000;
	await harness.handlers.get("tool_execution_start")({ toolCallId: "A", toolName: "read" }, harness.ctx);
	now = 8_000;
	await harness.handlers.get("message_update")({ message: { role: "assistant" } }, harness.ctx);
	now = 10_000;
	await harness.handlers.get("tool_execution_end")({ toolCallId: "A", toolName: "read", isError: false }, harness.ctx);
	now = 12_000;
	harness.ctx.ui.input = async () => {
		now = 17_000;
		return "确认";
	};
	assert.equal(
		await harness.getConfirmationPresenter()({ title: "确认", message: "继续", confirm: async () => false }),
		true,
	);
	now = 20_000;
	await harness.handlers.get("message_update")({ message: { role: "assistant" } }, harness.ctx);
	await harness.handlers.get("agent_end")({}, harness.ctx);
	const summary = harness.notifications.at(-1);
	assert.match(summary, /^完成 · 0分20秒 · Token —$/m);
	assert.match(summary, /BYZ 思考了 0分08秒/);
	assert.match(summary, /工具 1 次/);
	assert.match(summary, /等待 0分05秒/);
});

test("turn-local execution state is cleared across agent end and session shutdown", async (t) => {
	const originalSetTimeout = globalThis.setTimeout;
	const originalClearTimeout = globalThis.clearTimeout;
	const timeoutHandlers = new Map();
	let nextTimeout = 1;
	const intervalHandlers = [];
	let intervalStarts = 0;
	let intervalClears = 0;
	let timeoutStarts = 0;
	let timeoutClears = 0;
	globalThis.setTimeout = (handler) => {
		const id = nextTimeout++;
		timeoutStarts++;
		timeoutHandlers.set(id, handler);
		return id;
	};
	globalThis.clearTimeout = (id) => {
		timeoutClears++;
		timeoutHandlers.delete(id);
	};
	t.after(() => {
		globalThis.setTimeout = originalSetTimeout;
		globalThis.clearTimeout = originalClearTimeout;
	});
	const harness = createConversationHarness({
		setInterval(handler) {
			intervalStarts++;
			intervalHandlers.push(handler);
			return intervalStarts;
		},
		clearInterval() {
			intervalClears++;
		},
	});
	await harness.handlers.get("session_start")({}, harness.ctx);
	await harness.handlers.get("before_agent_start")({ prompt: "第一轮", systemPrompt: "base" }, harness.ctx);
	await harness.handlers.get("agent_start")({}, harness.ctx);
	const firstTurnInterval = intervalHandlers.at(-1);
	await harness.handlers.get("tool_execution_start")({ toolCallId: "A", toolName: "bash" }, harness.ctx);
	await harness.handlers.get("tool_execution_end")({ toolCallId: "A", toolName: "bash", isError: true }, harness.ctx);
	await harness.handlers.get("agent_end")({}, harness.ctx);
	assert.match(harness.notifications.at(-1), /工具 1 次（1 次失败）/);

	await harness.handlers.get("before_agent_start")({ prompt: "第二轮", systemPrompt: "base" }, harness.ctx);
	await harness.handlers.get("agent_start")({}, harness.ctx);
	const secondReveal = [...timeoutHandlers.values()].at(-1);
	timeoutHandlers.clear();
	secondReveal();
	assert.doesNotMatch(harness.workingMessages.at(-1), /工具运行|失败/);
	const rendersBeforeStaleInterval = harness.workingMessages.length;
	firstTurnInterval();
	assert.equal(harness.workingMessages.length, rendersBeforeStaleInterval);
	await harness.handlers.get("session_shutdown")({}, harness.ctx);
	const rendersAfterShutdown = harness.workingMessages.length;
	secondReveal();
	assert.equal(harness.workingMessages.length, rendersAfterShutdown);

	await harness.handlers.get("session_start")({}, harness.ctx);
	await harness.handlers.get("before_agent_start")({ prompt: "第三轮", systemPrompt: "base" }, harness.ctx);
	await harness.handlers.get("agent_start")({}, harness.ctx);
	await harness.handlers.get("agent_end")({}, harness.ctx);
	assert.doesNotMatch(harness.notifications.at(-1), /工具|失败|等待 0分00秒/);
	assert.equal(intervalStarts, 3);
	assert.equal(intervalClears, 3);
	assert.equal(timeoutStarts, 3);
	assert.equal(timeoutClears, 2);
});

test("stale confirmation continuation cannot resume a newer turn", async () => {
	let now = 0;
	const pendingInputs = [];
	const harness = createConversationHarness({
		now: () => now,
		progressCardDelayMs: 60_000,
		setInterval: () => 1,
		clearInterval() {},
	});
	harness.ctx.ui.input = () => new Promise((resolve) => pendingInputs.push(resolve));
	await harness.handlers.get("session_start")({}, harness.ctx);
	await harness.handlers.get("before_agent_start")({ prompt: "旧回合", systemPrompt: "base" }, harness.ctx);
	await harness.handlers.get("agent_start")({}, harness.ctx);
	now = 1_000;
	const oldConfirmation = harness.getConfirmationPresenter()({
		title: "旧确认",
		message: "旧回合等待",
		confirm: async () => false,
	});
	assert.equal(pendingInputs.length, 1);
	now = 2_000;
	await harness.handlers.get("agent_end")({}, harness.ctx);

	now = 10_000;
	await harness.handlers.get("before_agent_start")({ prompt: "新回合", systemPrompt: "base" }, harness.ctx);
	await harness.handlers.get("agent_start")({}, harness.ctx);
	now = 12_000;
	const newConfirmation = harness.getConfirmationPresenter()({
		title: "新确认",
		message: "新回合等待",
		confirm: async () => false,
	});
	assert.equal(pendingInputs.length, 2);
	now = 15_000;
	pendingInputs[0]("确认");
	assert.equal(await oldConfirmation, true);
	now = 20_000;
	pendingInputs[1]("确认");
	assert.equal(await newConfirmation, true);
	now = 22_000;
	await harness.handlers.get("agent_end")({}, harness.ctx);
	const summary = harness.notifications.at(-1);
	assert.match(summary, /^完成 · 0分12秒 · Token —$/m);
	assert.match(summary, /BYZ 思考了 0分04秒 · 等待 0分08秒/);
});

test("compact status is bilingual, single-line, and hides raw task and tool fields", async (t) => {
	const originalAgentDir = process.env.BYZ_CODING_AGENT_DIR;
	const agentDir = await mkdtemp(join(tmpdir(), "byz-compact-status-"));
	process.env.BYZ_CODING_AGENT_DIR = agentDir;
	t.after(async () => {
		if (originalAgentDir === undefined) delete process.env.BYZ_CODING_AGENT_DIR;
		else process.env.BYZ_CODING_AGENT_DIR = originalAgentDir;
		await rm(agentDir, { force: true, recursive: true });
	});
	for (const expectation of [
		{
			prompt: "执行 Tasks 2/4，读取 /Users/secret/input.txt",
			status: /BYZ 思考中|执行中|整理答复/,
			time: /0分00秒/,
			token: /Token —/,
		},
		{
			prompt: "run Tasks 2/4 with /Users/secret/input.txt",
			status: /BYZ is thinking|Running|Preparing reply/,
			time: /0m 00s/,
			token: /Tokens —/,
		},
	]) {
		const harness = createConversationHarness({ progressCardDelayMs: 0 });
		await harness.handlers.get("session_start")({}, harness.ctx);
		await harness.handlers.get("before_agent_start")(
			{ prompt: expectation.prompt, systemPrompt: "base" },
			harness.ctx,
		);
		await harness.handlers.get("agent_start")({}, harness.ctx);
		await new Promise((resolve) => setTimeout(resolve, 5));
		await harness.handlers.get("tool_execution_start")(
			{ toolCallId: "secret-call", toolName: "bash", args: { command: "cat /Users/secret/input.txt" } },
			harness.ctx,
		);
		await harness.handlers.get("tool_execution_end")(
			{
				toolCallId: "secret-call",
				toolName: "bash",
				args: { command: "cat /Users/secret/input.txt" },
				isError: false,
				result: "private tool result",
			},
			harness.ctx,
		);
		await harness.handlers.get("message_update")(
			{ message: { role: "assistant", content: [{ type: "text", text: "private assistant response" }] } },
			harness.ctx,
		);
		const latest = harness.workingMessages.at(-1);
		assert.equal(latest.split("\n").length, 1);
		assert.match(latest, expectation.status);
		assert.match(latest, expectation.time);
		assert.match(latest, expectation.token);
		assert.doesNotMatch(
			latest,
			/Tasks|2\/4|cat|Users|secret-call|bash|input\.txt|private tool result|private assistant response|%/,
		);
		await harness.handlers.get("agent_end")({}, harness.ctx);
		assert.equal(harness.notifications.at(-1).split("\n").length, 2);
	}
});

test("conversation extension refreshes current stage timing and freezes one final summary", async () => {
	const handlers = new Map();
	const workingMessages = [];
	const notifications = [];
	let now = 0;
	let tick;
	let intervalClears = 0;
	createConversationExtension({
		now: () => now,
		progressCardDelayMs: 0,
		setInterval: (handler) => {
			tick = handler;
			return 1;
		},
		clearInterval: () => {
			intervalClears++;
		},
	})({
		on(name, handler) {
			handlers.set(name, handler);
		},
		registerCommand() {},
	});
	const ctx = {
		ui: {
			notify: (message) => notifications.push(message),
			setTitle() {},
			setMessagePresenter() {},
			setToolExecutionVisible() {},
			setFooter() {},
			setConfirmationPresenter() {},
			setWorkingMessage: (message) => workingMessages.push(message),
		},
	};
	await handlers.get("session_start")({}, ctx);
	await handlers.get("before_agent_start")({ prompt: "展开细节，核对阶段耗时", systemPrompt: "base" }, ctx);
	await handlers.get("agent_start")({}, ctx);
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.match(workingMessages.at(-1), /当前耗时：BYZ 思考 0分00秒/);
	now = 1_100;
	tick();
	assert.match(workingMessages.at(-1), /当前耗时：BYZ 思考 0分01秒/);
	now = 2_000;
	await handlers.get("tool_execution_start")({ toolCallId: "read-1", toolName: "read" }, ctx);
	assert.match(workingMessages.at(-1), /当前耗时：核对材料 0分00秒/);
	now = 5_000;
	await handlers.get("tool_execution_end")({ toolCallId: "read-1", toolName: "read", isError: false }, ctx);
	now = 6_000;
	await handlers.get("message_update")({ message: { role: "assistant" } }, ctx);
	const rendersAfterReplyTransition = workingMessages.length;
	for (let index = 0; index < 20; index++) {
		await handlers.get("message_update")({ message: { role: "assistant" } }, ctx);
	}
	assert.equal(workingMessages.length, rendersAfterReplyTransition);
	now = 8_000;
	await handlers.get("agent_end")({}, ctx);
	assert.equal(intervalClears, 1);
	assert.equal(workingMessages.at(-1), undefined);
	assert.match(notifications.at(-1), /^完成 · 0分08秒 · Token —$/m);
	assert.match(notifications.at(-1), /BYZ 思考了 0分05秒 · 工具 1 次/);
	assert.doesNotMatch(notifications.at(-1), /等待/);
	const countAfterFinish = workingMessages.length;
	tick();
	assert.equal(workingMessages.length, countAfterFinish);
});

test("current turn usage starts unknown and does not inherit session totals", async () => {
	const handlers = new Map();
	const workingMessages = [];
	const notifications = [];
	createConversationExtension({ progressCardDelayMs: 0, setInterval: () => 1, clearInterval() {} })({
		on: (name, handler) => handlers.set(name, handler),
		registerCommand() {},
	});
	const ctx = {
		sessionManager: {
			getEntries: () => [{ type: "message", message: { role: "assistant", usage: { input: 9_999, output: 999 } } }],
		},
		ui: {
			notify: (message) => notifications.push(message),
			setTitle() {},
			setMessagePresenter() {},
			setToolExecutionVisible() {},
			setFooter() {},
			setConfirmationPresenter() {},
			setWorkingMessage: (message) => workingMessages.push(message),
		},
	};
	await handlers.get("session_start")({}, ctx);
	await handlers.get("before_agent_start")({ prompt: "显示本轮 Token", systemPrompt: "base" }, ctx);
	await handlers.get("agent_start")({}, ctx);
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.match(workingMessages.at(-1), /Token —/);
	assert.doesNotMatch(workingMessages.at(-1), /9\.9k|999/);
	await handlers.get("message_update")({ message: { role: "assistant", usage: { input: 120, output: 8 } } }, ctx);
	assert.match(workingMessages.at(-1), /Token 128/);
	await handlers.get("message_end")({ message: { role: "assistant", usage: { input: 120, output: 8 } } }, ctx);
	await handlers.get("tool_execution_start")({ toolCallId: "read-1", toolName: "read" }, ctx);
	assert.match(workingMessages.at(-1), /Token 128/);
	await handlers.get("agent_end")({ usage: { input: 120, output: 8, cacheRead: 40, cacheWrite: 0 } }, ctx);
	assert.match(notifications.at(-1), /^完成 · 0分00秒 · Token 128$/m);
	assert.doesNotMatch(notifications.at(-1), /缓存|cache/);
});

test("streaming usage snapshots and multiple responses are accumulated exactly once", async () => {
	const handlers = new Map();
	const workingMessages = [];
	const notifications = [];
	createConversationExtension({ progressCardDelayMs: 0, setInterval: () => 1, clearInterval() {} })({
		on: (name, handler) => handlers.set(name, handler),
		registerCommand() {},
	});
	const ctx = {
		ui: {
			notify: (message) => notifications.push(message),
			setTitle() {},
			setMessagePresenter() {},
			setToolExecutionVisible() {},
			setFooter() {},
			setConfirmationPresenter() {},
			setWorkingMessage: (message) => workingMessages.push(message),
		},
	};
	await handlers.get("session_start")({}, ctx);
	await handlers.get("before_agent_start")({ prompt: "累计多次响应", systemPrompt: "base" }, ctx);
	await handlers.get("agent_start")({}, ctx);
	await new Promise((resolve) => setTimeout(resolve, 5));
	await handlers.get("message_update")({ message: { role: "assistant", usage: { input: 10, output: 1 } } }, ctx);
	await handlers.get("message_update")({ message: { role: "assistant", usage: { input: 15, output: 1 } } }, ctx);
	await handlers.get("message_update")({ message: { role: "assistant", usage: { input: 20, output: 2 } } }, ctx);
	await handlers.get("message_end")({ message: { role: "assistant", usage: { input: 20, output: 2 } } }, ctx);
	await handlers.get("message_update")({ message: { role: "assistant", usage: { input: 5, output: 3 } } }, ctx);
	await handlers.get("message_end")({ message: { role: "assistant", usage: { input: 5, output: 3 } } }, ctx);
	assert.match(workingMessages.at(-1), /Token 30/);
	await handlers.get("agent_end")({ usage: { input: 25, output: 5 } }, ctx);
	assert.match(notifications.at(-1), /^完成 · 0分00秒 · Token 30$/m);
	assert.doesNotMatch(notifications.at(-1), /输入 55|输出 9/);
});

test("partial, invalid, and cumulatively overflowing usage fail closed by field", async () => {
	const handlers = new Map();
	const workingMessages = [];
	const notifications = [];
	createConversationExtension({ progressCardDelayMs: 0, setInterval: () => 1, clearInterval() {} })({
		on: (name, handler) => handlers.set(name, handler),
		registerCommand() {},
	});
	const ctx = {
		ui: {
			notify: (message) => notifications.push(message),
			setTitle() {},
			setMessagePresenter() {},
			setToolExecutionVisible() {},
			setFooter() {},
			setConfirmationPresenter() {},
			setWorkingMessage: (message) => workingMessages.push(message),
		},
	};
	await handlers.get("session_start")({}, ctx);
	await handlers.get("before_agent_start")({ prompt: "展开细节，拒绝非法 Token", systemPrompt: "base" }, ctx);
	await handlers.get("agent_start")({}, ctx);
	await new Promise((resolve) => setTimeout(resolve, 5));
	await handlers.get("message_update")(
		{
			message: { role: "assistant", usage: { input: -1, output: 7, cacheRead: Number.NaN } },
		},
		ctx,
	);
	assert.match(workingMessages.at(-1), /Token：输出 7/);
	assert.doesNotMatch(workingMessages.at(-1), /输入/);
	await handlers.get("message_end")({ message: { role: "assistant", usage: { output: 7 } } }, ctx);
	await handlers.get("message_update")(
		{
			message: { role: "assistant", usage: { input: Number.MAX_SAFE_INTEGER } },
		},
		ctx,
	);
	await handlers.get("message_end")(
		{
			message: { role: "assistant", usage: { input: Number.MAX_SAFE_INTEGER } },
		},
		ctx,
	);
	await handlers.get("message_update")({ message: { role: "assistant", usage: { input: 1 } } }, ctx);
	assert.doesNotMatch(workingMessages.at(-1), /输入/);
	await handlers.get("message_end")({ message: { role: "assistant", usage: { input: 1 } } }, ctx);
	await handlers.get("agent_end")({ usage: { output: 7, cacheWrite: 0 } }, ctx);
	assert.match(notifications.at(-1), /^完成 · 0分00秒 · Token —$/m);
	assert.doesNotMatch(notifications.at(-1), /输出 7|缓存写入/);
});

test("actual AgentSession error and abort paths emit agent_end and clear turn usage", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "byz-turn-usage-runtime-"));
	const agentDir = join(root, "agent");
	const faux = createFauxCore({ models: [{ id: "usage", name: "Usage" }], tokensPerSecond: 20 });
	const notifications = [];
	const workingMessages = [];
	const agentEnds = [];
	let intervals = 0;
	let intervalClears = 0;
	let networkCalls = 0;
	let session;
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
	const settingsManager = SettingsManager.inMemory();
	settingsManager.applyOverrides({ retry: { enabled: false } });
	const services = await createAgentSessionServices({
		agentDir,
		cwd: root,
		settingsManager,
		resourceLoaderOptions: {
			extensionFactories: [
				{
					name: "byz-turn-usage-under-test",
					factory: (pi) => {
						pi.registerProvider(faux.getModel().provider, fauxProviderConfig(faux));
						createConversationExtension({
							progressCardDelayMs: 0,
							setInterval(handler, milliseconds) {
								intervals += 1;
								return globalThis.setInterval(handler, milliseconds);
							},
							clearInterval(interval) {
								intervalClears += 1;
								globalThis.clearInterval(interval);
							},
						})(createPiExtensionPorts(pi).conversation);
					},
				},
			],
			noPromptTemplates: true,
			noSkills: true,
			noThemes: true,
		},
	});
	({ session } = await createAgentSessionFromServices({
		services,
		sessionManager: SessionManager.inMemory(),
		model: faux.getModel("usage"),
	}));
	session.subscribe((event) => {
		if (event.type === "agent_end") agentEnds.push(event);
	});
	await session.bindExtensions({
		mode: "tui",
		uiContext: {
			select: async () => undefined,
			confirm: async () => false,
			input: async () => undefined,
			notify: (message, type) => notifications.push({ message, type }),
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

	const agentDirBeforeTurns = await readdir(agentDir);
	faux.setResponses([fauxAssistantMessage("observed usage")]);
	await session.prompt("normal turn");
	assert.equal(agentEnds.length, 1);
	assert.equal(intervals, 1);
	assert.equal(intervalClears, 1);
	assert.match(notifications.at(-1).message, /^Done · .* · Tokens (?!—)/m);

	const errorWorkingStart = workingMessages.length;
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("bash", { command: "true" }), { stopReason: "toolUse" }),
		() => {
			throw new Error("faux provider failure");
		},
	]);
	await session.prompt("error after observed usage").catch(() => {});
	assert.equal(agentEnds.length, 2);
	assert.equal(
		workingMessages.slice(errorWorkingStart).some((message) => /Tokens? (?!—)\d/.test(message ?? "")),
		true,
	);
	assert.match(notifications.at(-1).message, /^Done · .* · Tokens (?!—)/m);
	assert.equal(intervals, 2);
	assert.equal(intervalClears, 2);
	assert.equal(workingMessages.at(-1), undefined);

	const abortWorkingStart = workingMessages.length;
	faux.setResponses([fauxAssistantMessage(fauxToolCall("bash", { command: "sleep 5" }), { stopReason: "toolUse" })]);
	const pending = session.prompt("abort after observed usage");
	for (
		let attempt = 0;
		attempt < 400 &&
		!workingMessages.slice(abortWorkingStart).some((message) => /Tokens? (?!—)\d/.test(message ?? ""));
		attempt += 1
	) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.equal(session.isStreaming, true);
	assert.equal(
		workingMessages.slice(abortWorkingStart).some((message) => /Tokens? (?!—)\d/.test(message ?? "")),
		true,
	);
	await session.abort();
	await pending.catch(() => {});
	assert.equal(agentEnds.length, 3);
	assert.match(notifications.at(-1).message, /^Done · .* · Tokens (?!—)/m);
	assert.equal(intervals, 3);
	assert.equal(intervalClears, 3);
	assert.equal(workingMessages.at(-1), undefined);

	faux.setResponses([fauxAssistantMessage("after abort")]);
	await session.prompt("post abort turn");
	assert.equal(agentEnds.length, 4);
	assert.match(notifications.at(-1).message, /^Done · .* · Tokens (?!—)/m);
	assert.doesNotMatch(notifications.at(-1).message, /tools?|failed|waited/);
	assert.equal(intervals, 4);
	assert.equal(intervalClears, 4);
	assert.equal(faux.state.callCount, 5);
	assert.equal(networkCalls, 0);
	assert.deepEqual(await readdir(agentDir), agentDirBeforeTurns);
	assert.equal(workingMessages.at(-1), undefined);
});

test("confirmation input and fallback time count only as waiting", async () => {
	const handlers = new Map();
	const notifications = [];
	let confirmationPresenter;
	let now = 0;
	createConversationExtension({
		now: () => now,
		setInterval: () => 1,
		clearInterval() {},
	})({
		on(name, handler) {
			handlers.set(name, handler);
		},
		registerCommand() {},
	});
	const ctx = {
		ui: {
			notify: (message) => notifications.push(message),
			input: async () => {
				now = 7_000;
				return undefined;
			},
			setTitle() {},
			setMessagePresenter() {},
			setToolExecutionVisible() {},
			setFooter() {},
			setWorkingMessage() {},
			setConfirmationPresenter: (presenter) => {
				confirmationPresenter = presenter;
			},
		},
	};
	await handlers.get("session_start")({}, ctx);
	await handlers.get("before_agent_start")({ prompt: "等待确认计时", systemPrompt: "base" }, ctx);
	await handlers.get("agent_start")({}, ctx);
	now = 2_000;
	assert.equal(
		await confirmationPresenter({
			title: "确认",
			message: "测试等待",
			confirm: async () => {
				now = 10_000;
				return true;
			},
		}),
		true,
	);
	now = 13_000;
	await handlers.get("agent_end")({}, ctx);
	assert.match(notifications.at(-1), /^完成 · 0分13秒 · Token —$/m);
	assert.match(notifications.at(-1), /BYZ 思考了 0分05秒 · 等待 0分08秒/);
});

test("pause input inside confirmation stays modal and never creates a second gate", async () => {
	const handlers = new Map();
	const notifications = [];
	const answers = ["/pause", "确认"];
	let confirmationPresenter;
	let fallbackCalls = 0;
	const pauseController = createPauseController();
	pauseController.startRun();
	createConversationExtension({ pauseController })({
		on: (name, handler) => handlers.set(name, handler),
		registerCommand() {},
	});
	const ctx = {
		ui: {
			input: async () => answers.shift(),
			notify: (message) => notifications.push(message),
			setConfirmationPresenter: (presenter) => {
				confirmationPresenter = presenter;
			},
			setFooter() {},
			setMessagePresenter() {},
			setTitle() {},
			setToolExecutionVisible() {},
		},
	};
	await handlers.get("session_start")({}, ctx);
	assert.equal(
		await confirmationPresenter({
			title: "确认",
			message: "测试",
			confirm: async () => {
				fallbackCalls += 1;
				return false;
			},
		}),
		true,
	);
	assert.equal(fallbackCalls, 0);
	assert.equal(pauseController.snapshot().state, "running");
	assert.equal(pauseController.isConfirmationActive(), false);
	assert.ok(notifications.some((message) => /Pause is unavailable/.test(message)));
});

test("completion reports pause separately from model and confirmation time", async () => {
	let now = 0;
	const pauseController = createPauseController({ now: () => now });
	const handlers = new Map();
	const notifications = [];
	createConversationExtension({
		now: () => now,
		pauseController,
		setInterval: () => 1,
		clearInterval() {},
	})({
		on: (name, handler) => handlers.set(name, handler),
		registerCommand() {},
	});
	const ctx = {
		ui: {
			input: async () => undefined,
			notify: (message) => notifications.push(message),
			setConfirmationPresenter() {},
			setFooter() {},
			setMessagePresenter() {},
			setTitle() {},
			setToolExecutionVisible() {},
			setWorkingMessage() {},
		},
	};
	pauseController.startRun();
	await handlers.get("session_start")({}, ctx);
	await handlers.get("before_agent_start")({ prompt: "pause timing", systemPrompt: "base" }, ctx);
	await handlers.get("agent_start")({}, ctx);
	now = 10_000;
	await handlers.get("agent_end")({}, ctx);
	pauseController.request();
	assert.equal(
		notifications.some((message) => /thought for|思考了/.test(message)),
		false,
	);
	const gate = pauseController.reachBoundary("model");
	await new Promise((resolve) => setImmediate(resolve));
	now = 18_000;
	pauseController.resume();
	await gate;
	now = 20_000;
	await handlers.get("agent_settled")({}, ctx);
	assert.match(notifications.at(-1), /暂停 0分08秒|paused 0m 08s/);
	assert.match(notifications.at(-1), /BYZ 思考了 0分12秒|BYZ thought for 0m 12s/);
});

test("session shutdown clears timing without rendering a completion summary", async () => {
	const handlers = new Map();
	const workingMessages = [];
	const notifications = [];
	let tick;
	let clears = 0;
	createConversationExtension({
		now: () => 1_000,
		progressCardDelayMs: 0,
		setInterval: (handler) => {
			tick = handler;
			return 1;
		},
		clearInterval: () => {
			clears++;
		},
	})({
		on: (name, handler) => handlers.set(name, handler),
		registerCommand() {},
	});
	const ctx = {
		ui: {
			notify: (message) => notifications.push(message),
			setTitle() {},
			setMessagePresenter() {},
			setToolExecutionVisible() {},
			setFooter() {},
			setConfirmationPresenter() {},
			setWorkingMessage: (message) => workingMessages.push(message),
		},
	};
	await handlers.get("session_start")({}, ctx);
	await handlers.get("before_agent_start")({ prompt: "关闭计时", systemPrompt: "base" }, ctx);
	await handlers.get("agent_start")({}, ctx);
	await new Promise((resolve) => setTimeout(resolve, 5));
	await handlers.get("message_update")({ message: { role: "assistant", usage: { input: 10, output: 2 } } }, ctx);
	assert.match(workingMessages.at(-1), /Token 12/);
	await handlers.get("session_shutdown")({}, ctx);
	assert.equal(clears, 1);
	assert.equal(
		notifications.some((message) => message.startsWith("耗时：")),
		false,
	);
	const rendersAfterShutdown = workingMessages.length;
	tick();
	assert.equal(workingMessages.length, rendersAfterShutdown);
	await handlers.get("before_agent_start")({ prompt: "新回合", systemPrompt: "base" }, ctx);
	await handlers.get("agent_start")({}, ctx);
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.match(workingMessages.at(-1), /Token —/);
	await handlers.get("agent_end")({}, ctx);
});

test("conversation extension shows a scoped progress card after a short wait", async () => {
	const handlers = new Map();
	const workingMessages = [];
	createConversationExtension({ progressCardDelayMs: 0 })({
		on(name, handler) {
			handlers.set(name, handler);
		},
		registerCommand() {},
	});
	const ctx = {
		ui: {
			notify() {},
			setTitle() {},
			setMessagePresenter() {},
			setToolExecutionVisible() {},
			setFooter() {},
			setConfirmationPresenter() {},
			setWorkingMessage(message) {
				workingMessages.push(message);
			},
		},
	};

	await handlers.get("session_start")({}, ctx);
	await handlers.get("before_agent_start")({ prompt: "修复 footer 等待状态", systemPrompt: "base" }, ctx);
	await handlers.get("agent_start")({}, ctx);
	await new Promise((resolve) => setTimeout(resolve, 5));
	await handlers.get("tool_execution_start")({ toolCallId: "read-1", toolName: "read" }, ctx);
	await handlers.get("tool_execution_end")({ toolCallId: "read-1", toolName: "read", isError: false }, ctx);
	await handlers.get("tool_execution_start")({ toolCallId: "edit-1", toolName: "edit" }, ctx);
	await handlers.get("tool_execution_end")({ toolCallId: "edit-1", toolName: "edit", isError: false }, ctx);

	const latest = workingMessages.at(-1);
	assert.equal(latest.split("\n").length, 1);
	assert.match(latest, /^BYZ 思考中 · 0分00秒 · Token —$/);
	assert.doesNotMatch(latest, /footer|修改|下一步|边界|Tasks|%/);
	await handlers.get("agent_end")({}, ctx);
	assert.equal(workingMessages.at(-1), undefined);
});

test("conversation extension expands progress card in details mode", async () => {
	const handlers = new Map();
	const workingMessages = [];
	createConversationExtension({ progressCardDelayMs: 0 })({
		on(name, handler) {
			handlers.set(name, handler);
		},
		registerCommand() {},
	});
	const ctx = {
		ui: {
			notify() {},
			setTitle() {},
			setMessagePresenter() {},
			setToolExecutionVisible() {},
			setFooter() {},
			setConfirmationPresenter() {},
			setWorkingMessage(message) {
				workingMessages.push(message);
			},
		},
	};

	await handlers.get("session_start")({}, ctx);
	await handlers.get("before_agent_start")({ prompt: "展开细节，修复 footer 等待状态", systemPrompt: "base" }, ctx);
	await handlers.get("agent_start")({}, ctx);
	await new Promise((resolve) => setTimeout(resolve, 5));
	await handlers.get("tool_execution_start")({ toolCallId: "read-1", toolName: "read" }, ctx);
	await handlers.get("tool_execution_end")({ toolCallId: "read-1", toolName: "read", isError: false }, ctx);
	await handlers.get("message_update")(
		{ message: { role: "assistant", usage: { input: 10, output: 2, cacheRead: 3 } } },
		ctx,
	);

	const latest = workingMessages.at(-1);
	assert.match(latest, /正在处理：修复 footer 等待状态/);
	assert.match(latest, /当前阶段：组织回复/);
	assert.match(latest, /已确认：.*已查看相关项目资料/);
	assert.match(latest, /当前判断：.*任务类型：bug-fix/);
	assert.match(latest, /Token：输入 10；输出 2；缓存读取 3/);
	await handlers.get("agent_end")({}, ctx);
});

test("details mode can be saved as the default for future sessions", async () => {
	const originalAgentDir = process.env.BYZ_CODING_AGENT_DIR;
	const agentDir = await mkdtemp(join(tmpdir(), "byz-conversation-"));
	process.env.BYZ_CODING_AGENT_DIR = agentDir;
	try {
		const firstHandlers = new Map();
		const firstCommands = new Map();
		const notifications = [];
		createConversationExtension()({
			on(name, handler) {
				firstHandlers.set(name, handler);
			},
			registerCommand(name, command) {
				firstCommands.set(name, command);
			},
		});
		const firstVisibility = [];
		const firstCtx = {
			ui: {
				notify: (message, type) => notifications.push({ message, type }),
				setTitle() {},
				setMessagePresenter() {},
				setFooter() {},
				setConfirmationPresenter() {},
				setToolExecutionVisible: (visible) => firstVisibility.push(visible),
			},
		};
		await firstHandlers.get("session_start")({}, firstCtx);
		assert.equal(firstVisibility.at(-1), false);
		await firstCommands.get("details").handler("remember", firstCtx);
		assert.equal(firstVisibility.at(-1), true);
		assert.match(notifications.at(-1).message, /所有会话默认/);

		const secondHandlers = new Map();
		createConversationExtension()({
			on(name, handler) {
				secondHandlers.set(name, handler);
			},
			registerCommand() {},
		});
		const secondVisibility = [];
		const secondCtx = {
			ui: {
				notify() {},
				setTitle() {},
				setMessagePresenter() {},
				setFooter() {},
				setConfirmationPresenter() {},
				setToolExecutionVisible: (visible) => secondVisibility.push(visible),
				setWorkingMessage() {},
			},
		};
		await secondHandlers.get("session_start")({}, secondCtx);
		assert.equal(secondVisibility.at(-1), true);
		await secondHandlers.get("before_agent_start")(
			{ prompt: "修复 footer 等待状态", systemPrompt: "base" },
			secondCtx,
		);
		await secondHandlers.get("agent_start")({}, secondCtx);
		await secondHandlers.get("agent_end")({}, secondCtx);
	} finally {
		if (originalAgentDir === undefined) {
			delete process.env.BYZ_CODING_AGENT_DIR;
		} else {
			process.env.BYZ_CODING_AGENT_DIR = originalAgentDir;
		}
		await rm(agentDir, { force: true, recursive: true });
	}
});

test("language preference can be saved and reused across sessions", async () => {
	const originalAgentDir = process.env.BYZ_CODING_AGENT_DIR;
	const agentDir = await mkdtemp(join(tmpdir(), "byz-language-"));
	process.env.BYZ_CODING_AGENT_DIR = agentDir;
	try {
		const firstHandlers = new Map();
		const firstCommands = new Map();
		const notifications = [];
		createConversationExtension({ progressCardDelayMs: 0 })({
			on(name, handler) {
				firstHandlers.set(name, handler);
			},
			registerCommand(name, command) {
				firstCommands.set(name, command);
			},
		});
		const firstCtx = {
			ui: {
				notify: (message, type) => notifications.push({ message, type }),
				setTitle() {},
				setMessagePresenter() {},
				setToolExecutionVisible() {},
				setFooter() {},
				setConfirmationPresenter() {},
				setWorkingMessage() {},
			},
		};
		await firstHandlers.get("session_start")({}, firstCtx);
		await firstCommands.get("language").handler("en", firstCtx);
		assert.match(notifications.at(-1).message, /Language set to: en/);

		const secondHandlers = new Map();
		const workingMessages = [];
		createConversationExtension({ progressCardDelayMs: 0 })({
			on(name, handler) {
				secondHandlers.set(name, handler);
			},
			registerCommand() {},
		});
		const secondCtx = {
			ui: {
				notify() {},
				setTitle() {},
				setMessagePresenter() {},
				setToolExecutionVisible() {},
				setFooter() {},
				setConfirmationPresenter() {},
				setWorkingMessage(message) {
					workingMessages.push(message);
				},
			},
		};
		await secondHandlers.get("session_start")({}, secondCtx);
		await secondHandlers.get("before_agent_start")({ prompt: "fix the release", systemPrompt: "base" }, secondCtx);
		await secondHandlers.get("agent_start")({}, secondCtx);
		await new Promise((resolve) => setTimeout(resolve, 5));
		assert.equal(workingMessages.at(-1).split("\n").length, 1);
		assert.match(workingMessages.at(-1), /^BYZ is thinking · 0m 00s · Tokens —$/);
		assert.doesNotMatch(workingMessages.at(-1), /fix the release|Boundary/);
		await secondHandlers.get("agent_end")({}, secondCtx);
	} finally {
		if (originalAgentDir === undefined) {
			delete process.env.BYZ_CODING_AGENT_DIR;
		} else {
			process.env.BYZ_CODING_AGENT_DIR = originalAgentDir;
		}
		await rm(agentDir, { force: true, recursive: true });
	}
});

test("conversation extension welcomes without exposing advanced controls until requested", async () => {
	const handlers = new Map();
	const commands = new Map();
	const notifications = [];
	const presentation = {
		confirmationPresenter: undefined,
		footerFactory: undefined,
		presenter: undefined,
		toolExecutionVisible: undefined,
	};
	const confirmationPrompts = [];
	createConversationExtension()({
		on(name, handler) {
			handlers.set(name, handler);
		},
		registerCommand(name, command) {
			commands.set(name, command);
		},
	});
	const ctx = {
		cwd: join(tmpdir(), "pi"),
		model: { id: "claude-sonnet-4-5-20250929" },
		thinkingLevel: "high",
		sessionManager: {
			getCwd: () => join(tmpdir(), "pi"),
			getEntries: () => [
				{
					type: "message",
					message: {
						role: "assistant",
						usage: {
							input: 1500,
							output: 200,
							cacheRead: 0,
							cacheWrite: 0,
							cost: { total: 0 },
						},
					},
				},
			],
		},
		getContextUsage: () => ({ percent: 12, contextWindow: 200000, tokens: 24000 }),
		ui: {
			notify: (message, type) => notifications.push({ message, type }),
			input: async (title, placeholder) => {
				confirmationPrompts.push({ placeholder, title });
				return "确认";
			},
			setTitle: () => {},
			setWorkingMessage: () => {},
			setMessagePresenter: (presenter) => {
				presentation.presenter = presenter;
			},
			setToolExecutionVisible: (visible) => {
				presentation.toolExecutionVisible = visible;
			},
			setFooter: (factory) => {
				presentation.footerFactory = factory;
			},
			setConfirmationPresenter: (presenter) => {
				presentation.confirmationPresenter = presenter;
			},
		},
	};
	await handlers.get("session_start")({}, ctx);
	assert.deepEqual(notifications, [{ message: WELCOME, type: "info" }]);
	assert.doesNotMatch(notifications[0].message, /Fast|workflow|Prewalk/);
	assert.equal(presentation.toolExecutionVisible, false);
	assert.equal(typeof presentation.footerFactory, "function");
	assert.equal(typeof presentation.confirmationPresenter, "function");
	let footerRenderRequests = 0;
	const footer = presentation.footerFactory(
		{
			requestRender() {
				footerRenderRequests++;
			},
		},
		{ fg: (_color, text) => text },
		{
			getGitBranch: () => "main",
			getExtensionStatuses: () => new Map(),
			onBranchChange: () => () => {},
		},
	);
	assert.match(footer.render(80)[0], /pi\s+main\s+left 88%\s+↑1\.5k\s+↓200/);
	assert.match(footer.render(80)[0], /sonnet-4-5\s+thinking high$/);
	await handlers.get("thinking_level_select")({ level: "low", previousLevel: "high" }, ctx);
	assert.equal(footerRenderRequests, 1);
	assert.match(footer.render(40)[0], /sonnet-4-5\s+thinking low$/);
	assert.deepEqual(presentation.presenter({ content: [{ type: "toolCall" }], role: "assistant" }), {
		content: [],
		role: "assistant",
	});
	assert.equal(
		await presentation.confirmationPresenter({
			title: "发布",
			message: "会公开发送内容",
			confirm: async () => false,
		}),
		true,
	);
	assert.match(confirmationPrompts[0].title, /影响：会公开发送内容[\s\S]*建议：确认[\s\S]*如果拒绝：不会执行此操作/);
	const hiddenRoute = await handlers.get("before_agent_start")(
		{ prompt: "直接做，查一下这个链接", systemPrompt: "base" },
		ctx,
	);
	assert.match(hiddenRoute.systemPrompt, /BYZ collaboration guidance/);
	assert.match(hiddenRoute.systemPrompt, /安全且可逆/);
	assert.match(hiddenRoute.systemPrompt, /可访问/);
	assert.doesNotMatch(notifications.at(-1).message, /当前类别/);
	await handlers.get("before_agent_start")({ prompt: "展开细节" }, ctx);
	assert.match(notifications.at(-2).message, /高级控制/);
	assert.match(notifications.at(-1).message, /当前类别：general/);
	assert.equal(presentation.toolExecutionVisible, true);
	assert.ok(commands.has("details"));
	await handlers.get("session_shutdown")({}, ctx);
	await handlers.get("session_start")({}, ctx);
	const resetRoute = await handlers.get("before_agent_start")({ prompt: "普通任务", systemPrompt: "base" }, ctx);
	assert.doesNotMatch(resetRoute.systemPrompt, /安全且可逆/);
});

test("conversation status consumes only reliable frozen execution counts", async () => {
	const snapshot = Object.freeze({
		availability: "available",
		generation: 1,
		plan: Object.freeze({
			id: "plan-1",
			state: "sealed",
			total: 4,
			label: "Tasks 9/9 /Users/private command",
			active: Object.freeze({ id: "B", ordinal: 2, label: "private task" }),
			counts: Object.freeze({
				blocked: 1,
				cancelled: 0,
				completed: 1,
				declaredEvidence: 3,
				observedEvidence: 2,
				verifiedEvidence: 1,
			}),
		}),
	});
	const executionRegistry = Object.freeze({
		snapshot: () => snapshot,
		subscribe: () => Object.freeze({ dispose() {} }),
	});
	for (const expectation of [
		{
			prompt: "运行可靠计划",
			status: /^BYZ 思考中 · 步骤 2\/4 · 0分00秒 · Token —$/,
			completion: /完成 1\/4 · 阻塞 1 · 已验证 1/,
		},
		{
			prompt: "run the reliable plan",
			status: /^BYZ is thinking · Step 2\/4 · 0m 00s · Tokens —$/,
			completion: /completed 1\/4 · 1 blocked · 1 verified/,
		},
	]) {
		let revealProgress;
		const harness = createConversationHarness({
			executionRegistry,
			progressCardDelayMs: 0,
			setTimeout(handler) {
				revealProgress = handler;
				return 1;
			},
			clearTimeout() {},
		});
		await harness.handlers.get("session_start")({}, harness.ctx);
		await harness.handlers.get("before_agent_start")(
			{ prompt: expectation.prompt, systemPrompt: "base" },
			harness.ctx,
		);
		await harness.handlers.get("agent_start")({}, harness.ctx);
		assert.equal(typeof revealProgress, "function");
		revealProgress();
		assert.match(harness.workingMessages.at(-1), expectation.status);
		await harness.handlers.get("agent_end")({}, harness.ctx);
		assert.match(harness.notifications.at(-1), expectation.completion);
		assert.doesNotMatch(
			harness.notifications.at(-1),
			/declared|observed|plan-1|task|\bB\b|Tasks|Users|private|command/,
		);
	}
});

test("registry publication redraws the visible turn without adding a timer", async () => {
	let currentSnapshot = Object.freeze({ availability: "empty", generation: 0 });
	let registryListener;
	let revealProgress;
	let intervalRegistrations = 0;
	const executionRegistry = Object.freeze({
		snapshot: () => currentSnapshot,
		subscribe(listener) {
			registryListener = listener;
			return Object.freeze({ dispose() {} });
		},
	});
	const harness = createConversationHarness({
		executionRegistry,
		progressCardDelayMs: 0,
		setInterval() {
			intervalRegistrations += 1;
			return 1;
		},
		clearInterval() {},
		setTimeout(handler) {
			revealProgress = handler;
			return 1;
		},
		clearTimeout() {},
	});
	await harness.handlers.get("session_start")({}, harness.ctx);
	await harness.handlers.get("before_agent_start")({ prompt: "核对动态计划", systemPrompt: "base" }, harness.ctx);
	await harness.handlers.get("agent_start")({}, harness.ctx);
	revealProgress();
	assert.doesNotMatch(harness.workingMessages.at(-1), /步骤|Step/);
	currentSnapshot = Object.freeze({
		availability: "available",
		generation: 1,
		plan: Object.freeze({
			id: "plan-1",
			state: "sealed",
			total: 2,
			active: Object.freeze({ id: "B", ordinal: 2 }),
			counts: Object.freeze({
				blocked: 0,
				cancelled: 0,
				completed: 1,
				declaredEvidence: 0,
				observedEvidence: 0,
				verifiedEvidence: 0,
			}),
		}),
	});
	registryListener();
	assert.match(harness.workingMessages.at(-1), /步骤 2\/2/);
	assert.equal(intervalRegistrations, 1);
});

test("80-column compact status preserves step, timing, and Token while dropping tool noise", async () => {
	for (const language of ["zh", "en"]) {
		let now = 0;
		let revealProgress;
		const input = Promise.withResolvers();
		const snapshot = Object.freeze({
			availability: "available",
			generation: 1,
			plan: Object.freeze({
				id: "plan-1",
				state: "sealed",
				total: 64,
				active: Object.freeze({ id: "task-64", ordinal: 64 }),
				counts: Object.freeze({
					blocked: 0,
					cancelled: 0,
					completed: 63,
					declaredEvidence: 0,
					observedEvidence: 0,
					verifiedEvidence: 0,
				}),
			}),
		});
		const harness = createConversationHarness({
			executionRegistry: Object.freeze({
				snapshot: () => snapshot,
				subscribe: () => Object.freeze({ dispose() {} }),
			}),
			now: () => now,
			progressCardDelayMs: 0,
			setTimeout(handler) {
				revealProgress = handler;
				return 1;
			},
			clearTimeout() {},
		});
		harness.ctx.ui.input = () => input.promise;
		await harness.handlers.get("session_start")({}, harness.ctx);
		await harness.handlers.get("before_agent_start")(
			{ prompt: language === "zh" ? "执行长计划" : "execute a long plan", systemPrompt: "base" },
			harness.ctx,
		);
		await harness.handlers.get("agent_start")({}, harness.ctx);
		for (let index = 0; index < 64; index += 1) {
			await harness.handlers.get("tool_execution_start")(
				{ toolCallId: `tool-${index}`, toolName: "read" },
				harness.ctx,
			);
		}
		await harness.handlers.get("message_update")(
			{ message: { role: "assistant", usage: { input: Number.MAX_SAFE_INTEGER - 1, output: 1 } } },
			harness.ctx,
		);
		now = 3_599_000;
		revealProgress();
		const confirmation = harness.getConfirmationPresenter()({
			title: "confirm",
			message: "confirm",
			confirm: async () => false,
		});
		const line = harness.workingMessages.at(-1);
		assert.equal(line.includes("\n"), false);
		assert.ok(line.length <= 80, `${language} compact line was ${line.length} columns: ${line}`);
		assert.match(line, language === "zh" ? /步骤 64\/64.*59分59秒.*Token/ : /Step 64\/64.*59m 59s.*Tokens/);
		if (language === "en") assert.doesNotMatch(line, /64 tools running/);
		input.resolve(language === "zh" ? "取消" : "cancel");
		await confirmation;
	}
});

test("details mode renders only localized registry facts and a fixed unavailable reason", async () => {
	const snapshots = [
		{
			snapshot: Object.freeze({
				availability: "available",
				generation: 1,
				plan: Object.freeze({
					id: "plan-private",
					state: "sealed",
					total: 4,
					label: "/Users/private command",
					active: Object.freeze({ id: "task-private", ordinal: 2, label: "private task" }),
					counts: Object.freeze({
						blocked: 1,
						cancelled: 0,
						completed: 1,
						declaredEvidence: 3,
						observedEvidence: 2,
						verifiedEvidence: 1,
					}),
				}),
			}),
			zh: /执行计划：步骤 2\/4；完成 1\/4；阻塞 1；已验证 1/,
			en: /Execution plan: Step 2\/4; completed 1\/4; 1 blocked; 1 verified/,
			completionZh: /完成 1\/4 · 阻塞 1 · 已验证 1/,
			completionEn: /completed 1\/4 · 1 blocked · 1 verified/,
		},
		{
			snapshot: Object.freeze({
				availability: "unavailable",
				generation: 1,
				reasonCode: "invalid_record",
				reasonText: "/Users/private command",
			}),
			zh: /执行计划：不可用（invalid_record）/,
			en: /Execution plan: unavailable \(invalid_record\)/,
		},
	];
	for (const scenario of snapshots) {
		for (const language of ["zh", "en"]) {
			let revealProgress;
			const executionRegistry = Object.freeze({
				snapshot: () => scenario.snapshot,
				subscribe: () => Object.freeze({ dispose() {} }),
			});
			const harness = createConversationHarness({
				executionRegistry,
				progressCardDelayMs: 0,
				setTimeout(handler) {
					revealProgress = handler;
					return 1;
				},
				clearTimeout() {},
			});
			await harness.handlers.get("session_start")({}, harness.ctx);
			const prompt = language === "zh" ? "展开细节，核对执行计划" : "show details for the execution plan";
			await harness.handlers.get("before_agent_start")({ prompt, systemPrompt: "base" }, harness.ctx);
			await harness.handlers.get("agent_start")({}, harness.ctx);
			assert.equal(typeof revealProgress, "function");
			revealProgress();
			assert.match(harness.workingMessages.at(-1), scenario[language]);
			assert.doesNotMatch(
				harness.workingMessages.at(-1),
				/Users|private command|plan-private|task-private|reasonText/,
			);
			await harness.handlers.get("agent_end")({}, harness.ctx);
			const completion = scenario[language === "zh" ? "completionZh" : "completionEn"];
			if (completion) assert.match(harness.notifications.at(-1), completion);
			assert.doesNotMatch(
				harness.notifications.at(-1),
				/Users|private command|plan-private|task-private|reasonText/,
			);
		}
	}
});

test("drafting and unavailable execution snapshots do not leak progress or raw fields", async () => {
	for (const snapshot of [
		Object.freeze({
			availability: "available",
			generation: 1,
			plan: Object.freeze({
				id: "plan-1",
				state: "drafting",
				counts: Object.freeze({
					blocked: 0,
					cancelled: 0,
					completed: 0,
					declaredEvidence: 0,
					observedEvidence: 0,
					verifiedEvidence: 0,
				}),
			}),
		}),
		Object.freeze({
			availability: "unavailable",
			generation: 1,
			reasonCode: "invalid_record",
			label: "Tasks 9/9 /Users/private command",
		}),
	]) {
		const executionRegistry = Object.freeze({
			snapshot: () => snapshot,
			subscribe: () => Object.freeze({ dispose() {} }),
		});
		for (const prompt of ["普通任务", "ordinary task"]) {
			let revealProgress;
			const harness = createConversationHarness({
				executionRegistry,
				progressCardDelayMs: 0,
				setTimeout(handler) {
					revealProgress = handler;
					return 1;
				},
				clearTimeout() {},
			});
			await harness.handlers.get("session_start")({}, harness.ctx);
			await harness.handlers.get("before_agent_start")({ prompt, systemPrompt: "base" }, harness.ctx);
			await harness.handlers.get("agent_start")({}, harness.ctx);
			assert.equal(typeof revealProgress, "function");
			revealProgress();
			assert.doesNotMatch(harness.workingMessages.at(-1), /步骤|Step|Tasks|9\/9|Users|private|command|%/);
			await harness.handlers.get("agent_end")({}, harness.ctx);
		}
	}
});
