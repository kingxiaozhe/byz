import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createInteractionPolicy, formatDecision, parseConversationControl } from "./interaction-policy.js";
import { createRoutingPolicy } from "./routing-policy.js";

const WELCOME = "BYZ\n\n你想让我帮你做什么？";
const DETAIL_MODE_COMPACT = "compact";
const DETAIL_MODE_DETAILS = "details";

function getByzAgentDir() {
	return process.env.BYZ_CODING_AGENT_DIR || join(homedir(), ".byz", "agent");
}

function getConversationConfigPath() {
	return join(getByzAgentDir(), "conversation.json");
}

function readConversationConfig() {
	try {
		return JSON.parse(readFileSync(getConversationConfigPath(), "utf8"));
	} catch {
		return {};
	}
}

function getSavedDetailMode() {
	const mode = readConversationConfig().detailMode;
	return mode === DETAIL_MODE_DETAILS ? DETAIL_MODE_DETAILS : DETAIL_MODE_COMPACT;
}

function saveDetailMode(mode) {
	const configPath = getConversationConfigPath();
	mkdirSync(dirname(configPath), { recursive: true });
	writeFileSync(configPath, `${JSON.stringify({ ...readConversationConfig(), detailMode: mode }, null, "\t")}\n`);
}

function formatTokens(count) {
	if (count < 1000) return String(count);
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function truncateText(text, width) {
	if (width <= 0) return "";
	if (text.length <= width) return text;
	if (width <= 1) return "…".slice(0, width);
	return `${text.slice(0, width - 1)}…`;
}

function findProjectRoot(cwd) {
	let dir = cwd;
	while (dir) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return cwd;
		dir = parent;
	}
	return cwd;
}

function getProjectName(cwd) {
	return basename(findProjectRoot(cwd)) || basename(cwd) || cwd;
}

function addUsage(totals, usage) {
	if (!usage) return;
	totals.input += usage.input ?? 0;
	totals.output += usage.output ?? 0;
	totals.cacheRead += usage.cacheRead ?? 0;
	totals.cacheWrite += usage.cacheWrite ?? 0;
	totals.cost += usage.cost?.total ?? 0;
}

function getUsageTotals(ctx) {
	const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	for (const entry of ctx.sessionManager?.getEntries?.() ?? []) {
		if (entry.type === "message" && entry.message?.role === "assistant") {
			addUsage(totals, entry.message.usage);
		} else if (entry.type === "message" && entry.message?.role === "toolResult") {
			addUsage(totals, entry.message.usage);
		} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
			addUsage(totals, entry.usage);
		}
	}
	return totals;
}

function shortModelName(modelId) {
	if (!modelId) return "no-model";
	return modelId
		.replace(/^claude-/, "")
		.replace(/^gpt-/, "gpt-")
		.replace(/-20\d{6}$/, "")
		.replace(/-latest$/, "");
}

function createByzFooter(ctx, tui, theme, footerData) {
	const unsubscribe = footerData.onBranchChange?.(() => tui.requestRender?.());
	return {
		invalidate() {},
		dispose() {
			unsubscribe?.();
		},
		render(width) {
			const safeWidth = Math.max(1, width ?? 80);
			const cwd = ctx.sessionManager?.getCwd?.() ?? ctx.cwd ?? process.cwd();
			const parts = [getProjectName(cwd)];
			const branch = footerData.getGitBranch?.();
			if (branch) parts.push(branch);

			const contextUsage = ctx.getContextUsage?.();
			if (contextUsage) {
				const left = contextUsage.percent === null ? "?" : `${Math.max(0, 100 - contextUsage.percent).toFixed(0)}%`;
				parts.push(`left ${left}`);
			}

			const usage = getUsageTotals(ctx);
			if (usage.input > 0) parts.push(`↑${formatTokens(usage.input)}`);
			if (usage.output > 0) parts.push(`↓${formatTokens(usage.output)}`);
			if (usage.cacheRead > 0) parts.push(`R${formatTokens(usage.cacheRead)}`);
			if (usage.cacheWrite > 0) parts.push(`W${formatTokens(usage.cacheWrite)}`);
			if (usage.cost > 0) parts.push(`$${usage.cost.toFixed(3)}`);

			const extensionStatuses = footerData.getExtensionStatuses?.();
			for (const text of extensionStatuses?.values?.() ?? []) {
				const clean = String(text)
					.replace(/[\r\n\t]/g, " ")
					.replace(/ +/g, " ")
					.trim();
				if (clean) parts.push(clean);
			}

			const leftText = parts.join("  ");
			const modelText = shortModelName(ctx.model?.id);
			const minGap = 2;
			let line;
			if (leftText.length + minGap + modelText.length <= safeWidth) {
				line = `${leftText}${" ".repeat(safeWidth - leftText.length - modelText.length)}${modelText}`;
			} else {
				const modelBudget = Math.min(modelText.length, Math.max(0, safeWidth - minGap - 12));
				const model = truncateText(modelText, modelBudget);
				const leftBudget = Math.max(1, safeWidth - minGap - model.length);
				line = `${truncateText(leftText, leftBudget)}${" ".repeat(Math.max(minGap, safeWidth - leftBudget - model.length))}${model}`;
			}
			return [theme.fg?.("dim", line) ?? line];
		},
	};
}

function createProgressState() {
	return {
		goal: "当前任务",
		stage: "确认目标与边界",
		confirmed: [],
		judgements: [],
		nextSteps: ["完成必要检查", "整理结果给你"],
		safeguards: ["不会提交代码", "不会执行高影响动作"],
		tools: { inspected: 0, edited: 0, commands: 0 },
		visible: false,
	};
}

function pushUnique(list, value, limit = 3) {
	if (!value || list.includes(value)) return;
	list.push(value);
	if (list.length > limit) list.shift();
}

function summarizeGoal(prompt) {
	const clean = String(prompt ?? "")
		.replace(/[\r\n\t]/g, " ")
		.replace(/展开细节[，,；;\s]*/g, "")
		.replace(/ +/g, " ")
		.trim();
	if (!clean) return "当前任务";
	return clean.length > 28 ? `${clean.slice(0, 27)}…` : clean;
}

function getActivitySummary(state) {
	const activity = [];
	if (state.tools.inspected > 0) activity.push(`查看 ${state.tools.inspected} 项`);
	if (state.tools.edited > 0) activity.push(`修改 ${state.tools.edited} 项`);
	if (state.tools.commands > 0) activity.push(`命令 ${state.tools.commands} 次`);
	return activity.join("，");
}

function renderProgressCard(state, options = {}) {
	const activity = getActivitySummary(state);
	if (options.compact) {
		const progress = activity || state.confirmed.at(-1) || state.stage;
		const next = state.nextSteps.at(-1) ?? "整理结果给你";
		const boundary = state.safeguards.at(-1) ?? "不会提交代码";
		return [`处理中：${state.goal}`, `进展：${progress}`, `下一步：${next}`, `边界：${boundary}`].join("\n");
	}

	const lines = [`正在处理：${state.goal}`, `当前阶段：${state.stage}`];
	if (activity) lines.push(`现场进展：${activity}`);
	if (state.confirmed.length > 0) lines.push(`已确认：${state.confirmed.join("；")}`);
	if (state.judgements.length > 0) lines.push(`当前判断：${state.judgements.join("；")}`);
	if (state.nextSteps.length > 0) lines.push(`下一步：${state.nextSteps.join("；")}`);
	if (state.safeguards.length > 0) lines.push(`不会做：${state.safeguards.join("；")}`);
	return lines.join("\n");
}

function stageForTool(toolName) {
	if (["read", "grep", "find", "ls"].includes(toolName)) return "定位和核对相关材料";
	if (["edit", "write"].includes(toolName)) return "执行最小必要修改";
	if (["bash", "powershell"].includes(toolName)) return "运行命令并核对结果";
	return "处理必要步骤";
}

function updateProgressFromToolStart(state, toolName) {
	state.stage = stageForTool(toolName);
	if (["read", "grep", "find", "ls"].includes(toolName)) {
		pushUnique(state.nextSteps, "基于证据判断方案");
	} else if (["edit", "write"].includes(toolName)) {
		pushUnique(state.judgements, "优先做小改动，避免扩大范围");
		pushUnique(state.nextSteps, "补充验证");
	} else if (["bash", "powershell"].includes(toolName)) {
		pushUnique(state.nextSteps, "根据命令结果决定是否继续");
	}
}

function updateProgressFromToolEnd(state, toolName, isError) {
	if (["read", "grep", "find", "ls"].includes(toolName)) {
		state.tools.inspected += 1;
		pushUnique(state.confirmed, "已查看相关项目资料");
	} else if (["edit", "write"].includes(toolName)) {
		state.tools.edited += 1;
		pushUnique(state.confirmed, isError ? "修改步骤需要复核" : "已完成代码层面的变更");
	} else if (["bash", "powershell"].includes(toolName)) {
		state.tools.commands += 1;
		pushUnique(state.confirmed, isError ? "命令结果需要处理" : "已执行验证命令");
	}
	if (isError) {
		state.stage = "处理异常结果";
		pushUnique(state.judgements, "先解释失败原因，再决定是否调整");
		return;
	}
	state.stage = "继续核对并收敛结果";
}

export function createConversationExtension(options = {}) {
	const policy = createInteractionPolicy();
	const routingPolicy = createRoutingPolicy();
	const progressCardDelayMs = options.progressCardDelayMs ?? 8_000;
	let savedDetailMode = getSavedDetailMode();

	return function conversationExtension(pi) {
		let progressTimer;
		let progressState = createProgressState();
		let activeCtx;

		function clearProgressTimer() {
			if (progressTimer) clearTimeout(progressTimer);
			progressTimer = undefined;
		}

		function publishProgress() {
			if (!activeCtx) return;
			progressState.visible = true;
			activeCtx.ui.setWorkingMessage?.(renderProgressCard(progressState, { compact: !policy.isDetailEnabled() }));
		}

		function updateVisibleProgress() {
			if (progressState.visible) publishProgress();
		}

		pi.on("session_start", (_event, ctx) => {
			routingPolicy.reset();
			policy.setDetailEnabled(savedDetailMode === DETAIL_MODE_DETAILS);
			ctx.ui.setTitle?.("BYZ");
			ctx.ui.setMessagePresenter?.((message) => policy.presentAssistantMessage(message));
			ctx.ui.setToolExecutionVisible?.(policy.isDetailEnabled());
			ctx.ui.setFooter?.((tui, theme, footerData) => createByzFooter(ctx, tui, theme, footerData));
			ctx.ui.setConfirmationPresenter?.(async ({ title, message, confirm }) => {
				const prompt = formatDecision({
					impact: message,
					recommendation: "确认",
					alternative: "取消",
					onReject: "不会执行此操作",
				});
				const answer = await ctx.ui.input(prompt, `${title}：输入“确认”或“取消”`);
				const choice = answer ? parseConversationControl(answer) : undefined;
				if (choice === "accept" || choice === "proceed") return true;
				if (choice === "reject") return false;
				return confirm();
			});
			ctx.ui.notify(WELCOME, "info");
		});
		pi.on("agent_start", (_event, ctx) => {
			activeCtx = ctx;
			policy.resetProgress();
			progressState.visible = false;
			clearProgressTimer();
			ctx.ui.setWorkingMessage?.("正在确认目标与边界…");
			progressTimer = setTimeout(() => {
				publishProgress();
			}, progressCardDelayMs);
		});
		pi.on("tool_execution_start", (event) => {
			updateProgressFromToolStart(progressState, event.toolName);
			updateVisibleProgress();
		});
		pi.on("tool_execution_end", (event) => {
			updateProgressFromToolEnd(progressState, event.toolName, event.isError);
			updateVisibleProgress();
		});
		pi.on("message_update", (event) => {
			if (event.message?.role !== "assistant") return;
			progressState.stage = "组织回复";
			pushUnique(progressState.nextSteps, "给出结论和已做验证");
			updateVisibleProgress();
		});
		pi.on("agent_end", () => {
			clearProgressTimer();
			activeCtx?.ui.setWorkingMessage?.();
			activeCtx = undefined;
		});
		pi.on("session_shutdown", () => {
			routingPolicy.reset();
			clearProgressTimer();
			activeCtx?.ui.setWorkingMessage?.();
			activeCtx = undefined;
		});
		function applyDetailMode(ctx, mode, options = {}) {
			policy.setDetailEnabled(mode === DETAIL_MODE_DETAILS);
			ctx.ui.setToolExecutionVisible?.(policy.isDetailEnabled());
			if (options.remember) {
				saveDetailMode(mode);
				savedDetailMode = mode;
			}
			if (mode === DETAIL_MODE_DETAILS) {
				const scope = options.remember ? "已设为所有会话默认" : "仅当前会话";
				ctx.ui.notify(`已展开细节（${scope}）。高级控制：/fast、/prewalk、/workflow。`, "info");
				return;
			}
			const scope = options.remember ? "已设为所有会话默认" : "仅当前会话";
			ctx.ui.notify(`已切回紧凑模式（${scope}）。`, "info");
		}

		function handleDetailsCommand(args, ctx) {
			const action = String(args ?? "")
				.trim()
				.toLowerCase();
			if (!action || action === "on") {
				applyDetailMode(ctx, DETAIL_MODE_DETAILS);
				return;
			}
			if (["off", "compact"].includes(action)) {
				applyDetailMode(ctx, DETAIL_MODE_COMPACT);
				return;
			}
			if (["remember", "save", "details"].includes(action)) {
				applyDetailMode(ctx, DETAIL_MODE_DETAILS, { remember: true });
				return;
			}
			if (["remember compact", "save compact", "compact remember"].includes(action)) {
				applyDetailMode(ctx, DETAIL_MODE_COMPACT, { remember: true });
				return;
			}
			if (action === "status") {
				const current = policy.isDetailEnabled() ? DETAIL_MODE_DETAILS : DETAIL_MODE_COMPACT;
				ctx.ui.notify(`当前：${current}。默认：${savedDetailMode}。`, "info");
				return;
			}
			ctx.ui.notify("用法：/details [on|off|remember|remember compact|status]", "warning");
		}

		pi.registerCommand("details", {
			description: "Configure BYZ detail mode",
			handler: async (args, ctx) => handleDetailsCommand(args, ctx),
		});
		pi.on("before_agent_start", async (event, ctx) => {
			const route = routingPolicy.route(event.prompt);
			progressState = createProgressState();
			progressState.goal = summarizeGoal(event.prompt);
			pushUnique(progressState.confirmed, "已收到目标");
			if (route.kind !== "general") pushUnique(progressState.judgements, `任务类型：${route.kind}`);
			if (route.preferences.autonomy === "confirm-key-actions") {
				pushUnique(progressState.safeguards, "关键动作会先确认");
			}
			if (route.details || parseConversationControl(event.prompt) === "detail") {
				applyDetailMode(ctx, DETAIL_MODE_DETAILS);
			}
			if (policy.isDetailEnabled()) {
				ctx.ui.notify(
					`当前类别：${route.kind}。当前偏好：主动程度 ${route.preferences.autonomy}，交付 ${route.preferences.delivery}。`,
					"info",
				);
			}
			return {
				systemPrompt: `${event.systemPrompt ?? ""}\n\nBYZ collaboration guidance for this turn:\n${route.instructions}`,
			};
		});
	};
}

export { WELCOME };
