import assert from "node:assert/strict";
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

test("conversation extension welcomes without exposing advanced controls until requested", async () => {
	const handlers = new Map();
	const commands = new Map();
	const notifications = [];
	const presentation = { confirmationPresenter: undefined, presenter: undefined, toolExecutionVisible: undefined };
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
			setConfirmationPresenter: (presenter) => {
				presentation.confirmationPresenter = presenter;
			},
		},
	};
	await handlers.get("session_start")({}, ctx);
	assert.deepEqual(notifications, [{ message: WELCOME, type: "info" }]);
	assert.doesNotMatch(notifications[0].message, /Fast|workflow|Prewalk/);
	assert.equal(presentation.toolExecutionVisible, false);
	assert.equal(typeof presentation.confirmationPresenter, "function");
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
