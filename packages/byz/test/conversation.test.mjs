import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createConversationExtension, WELCOME } from "../src/conversation/conversation-extension.js";
import {
	createInteractionPolicy,
	formatDecision,
	parseConversationControl,
} from "../src/conversation/interaction-policy.js";
import { classifyRequest, createRoutingPolicy, parseSessionPreference } from "../src/conversation/routing-policy.js";

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
		{ content: [{ type: "text", text: "内部设置 内部设置 complete" }], role: "assistant" },
	);
	policy.setDetailEnabled(true);
	assert.equal(policy.present("advanced-control", "Fast"), "Fast");
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
	await handlers.get("tool_execution_start")({ toolName: "read" }, ctx);
	await handlers.get("tool_execution_end")({ toolName: "read", isError: false }, ctx);
	await handlers.get("tool_execution_start")({ toolName: "edit" }, ctx);
	await handlers.get("tool_execution_end")({ toolName: "edit", isError: false }, ctx);

	const latest = workingMessages.at(-1);
	assert.match(latest, /处理中：修复 footer 等待状态/);
	assert.match(latest, /进展：查看 1 项，修改 1 项/);
	assert.match(latest, /下一步：补充验证/);
	assert.match(latest, /边界：不会执行高影响动作/);
	assert.doesNotMatch(latest, /正在处理，稍后给你结果/);
	assert.doesNotMatch(latest, /当前判断：/);
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
	await handlers.get("tool_execution_start")({ toolName: "read" }, ctx);
	await handlers.get("tool_execution_end")({ toolName: "read", isError: false }, ctx);

	const latest = workingMessages.at(-1);
	assert.match(latest, /正在处理：修复 footer 等待状态/);
	assert.match(latest, /当前阶段：继续核对并收敛结果/);
	assert.match(latest, /已确认：.*已查看相关项目资料/);
	assert.match(latest, /当前判断：.*任务类型：bug-fix/);
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
	const footer = presentation.footerFactory(
		{ requestRender() {} },
		{ fg: (_color, text) => text },
		{
			getGitBranch: () => "main",
			getExtensionStatuses: () => new Map(),
			onBranchChange: () => () => {},
		},
	);
	assert.match(footer.render(80)[0], /pi\s+main\s+left 88%\s+↑1\.5k\s+↓200/);
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
