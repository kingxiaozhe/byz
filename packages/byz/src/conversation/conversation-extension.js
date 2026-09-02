import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createInteractionPolicy, formatDecision, parseConversationControl } from "./interaction-policy.js";
import { createRoutingPolicy } from "./routing-policy.js";
import { createTurnTiming, formatElapsed } from "./turn-timing.js";

const WELCOME = "BYZ\n\n你想让我帮你做什么？";
const DETAIL_MODE_COMPACT = "compact";
const DETAIL_MODE_DETAILS = "details";
const LANGUAGE_AUTO = "auto";
const LANGUAGE_ZH = "zh";
const LANGUAGE_EN = "en";
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const MODEL_ACTIVE_STAGES = new Set(["think", "recover", "reply"]);

const EXECUTION_TEXT = {
	zh: {
		status: {
			think: "BYZ 思考中",
			inspect: "核对中",
			modify: "修改中",
			command: "执行中",
			other: "执行中",
			recover: "处理异常",
			reply: "整理答复",
			waiting: "等待确认",
		},
		runningTools: (count) => `${count} 个工具运行`,
		completion: "完成",
		modelActive: (elapsed) => `BYZ 思考了 ${elapsed}`,
		toolSummary: (calls, failures) => `工具 ${calls} 次${failures > 0 ? `（${failures} 次失败）` : ""}`,
		waitingSummary: (elapsed) => `等待 ${elapsed}`,
	},
	en: {
		status: {
			think: "BYZ is thinking",
			inspect: "Checking",
			modify: "Editing",
			command: "Running",
			other: "Running",
			recover: "Recovering",
			reply: "Preparing reply",
			waiting: "Waiting for confirmation",
		},
		runningTools: (count) => `${count} ${count === 1 ? "tool" : "tools"} running`,
		completion: "Done",
		modelActive: (elapsed) => `BYZ thought for ${elapsed}`,
		toolSummary: (calls, failures) =>
			`${calls} ${calls === 1 ? "tool" : "tools"}${failures > 0 ? ` (${failures} failed)` : ""}`,
		waitingSummary: (elapsed) => `waited ${elapsed}`,
	},
};

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

function saveConversationConfig(changes) {
	const configPath = getConversationConfigPath();
	mkdirSync(dirname(configPath), { recursive: true });
	writeFileSync(configPath, `${JSON.stringify({ ...readConversationConfig(), ...changes }, null, "\t")}\n`);
}

function saveDetailMode(mode) {
	saveConversationConfig({ detailMode: mode });
}

function getSavedLanguage() {
	const language = readConversationConfig().language;
	return [LANGUAGE_AUTO, LANGUAGE_ZH, LANGUAGE_EN].includes(language) ? language : LANGUAGE_AUTO;
}

function saveLanguage(language) {
	saveConversationConfig({ language });
}

function detectLanguage(input, savedLanguage = LANGUAGE_AUTO) {
	if (savedLanguage !== LANGUAGE_AUTO) return savedLanguage;
	const text = String(input ?? "");
	if (!text.trim()) return LANGUAGE_ZH;
	return /[\u4e00-\u9fff]/.test(text) ? LANGUAGE_ZH : LANGUAGE_EN;
}

const TEXT = {
	zh: {
		initialWorking: "正在确认目标与边界…",
		stageLabels: {
			think: "BYZ 思考",
			goal: "确认目标与边界",
			inspect: "定位和核对相关材料",
			modify: "执行最小必要修改",
			command: "运行命令并核对结果",
			recover: "处理异常结果",
			reply: "组织回复",
			other: "继续核对并收敛结果",
		},
		stageShortLabels: {
			think: "BYZ 思考",
			goal: "确认目标",
			inspect: "核对材料",
			modify: "执行修改",
			command: "命令验证",
			recover: "处理异常",
			reply: "组织回复",
			other: "继续核对",
		},
		timingWorking: ({ shortStage, stageElapsed, active, waiting }) =>
			`正在处理 · ${shortStage} · ${stageElapsed}\n执行 ${active} · 等待确认 ${waiting}`,
		timingLines: ({ shortStage, stageElapsed, active, waiting }) => [
			`当前耗时：${shortStage} ${stageElapsed}`,
			`累计：执行 ${active} · 等待确认 ${waiting}`,
		],
		timingSummary: ({ stages, active, waiting, total }) =>
			`耗时：${stages}。执行 ${active}；等待确认 ${waiting}；总历时 ${total}。`,
		defaultGoal: "当前任务",
		stageConfirm: "确认目标与边界",
		defaultNext: ["完成必要检查", "整理结果给你"],
		defaultSafeguards: ["不会擅自做高风险动作", "需要人决策时会停下来说明"],
		fallbackActivity: "正在把技术步骤整理成可读结果",
		compactLines: ({ state, activity, next, boundary }) => [
			`处理中：${state.goal}`,
			`进展：${activity}`,
			`下一步：${next}`,
			`边界：${boundary}`,
		],
		detailLines: ({ state, activity }) => {
			const lines = [`正在处理：${state.goal}`, `当前阶段：${state.stage}`, `现场进展：${activity}`];
			if (state.confirmed.length > 0) lines.push(`已确认：${state.confirmed.join("；")}`);
			if (state.judgements.length > 0) lines.push(`当前判断：${state.judgements.join("；")}`);
			if (state.nextSteps.length > 0) lines.push(`下一步：${state.nextSteps.join("；")}`);
			if (state.safeguards.length > 0) lines.push(`边界：${state.safeguards.join("；")}`);
			return lines;
		},
		readActivity: (target) => `查看 ${target ?? "相关文件"}，是为了基于真实内容判断下一步。`,
		editActivity: (target, isError) =>
			`${isError ? "尝试修改" : "修改"} ${target ?? "相关文件"}，是为了用最小改动解决当前问题。`,
		writeActivity: (target, isError) =>
			`${isError ? "尝试写入" : "写入"} ${target ?? "文件"}，是为了补齐当前目标需要的内容。`,
		commandActivity: (command) => `执行 ${command.label}，是为了${command.purpose}。`,
		toolActivity: (toolName) => `处理 ${toolName}，是为了推进当前目标。`,
		commandPurposes: [
			[/^npm run check\b/, "确认代码格式、类型和仓库规则都通过"],
			[/^npm run build:byz(?::offline)?\b/, "构建 BYZ 发布产物，确认打包流程可用"],
			[/^npm --prefix packages\/byz test\b/, "运行 BYZ 自身测试，确认改动没有破坏已有功能"],
			[/^node --test\b/, "运行指定回归测试，确认这次修复覆盖到问题"],
			[/^npm run release:byz\b/, "生成 BYZ 发布包并执行发布前校验"],
			[/^git status\b/, "确认只处理本次相关文件，避免影响其他工作"],
			[/^git add\b/, "只暂存本次改动，准备生成可追溯提交"],
			[/^git commit\b/, "记录本次改动，方便发布和回滚"],
			[/^git push\b/, "把已确认的改动同步到远端，触发后续发布流程"],
			[/^gh run watch\b/, "等待线上发布流程完成，确认结果不是只在本地通过"],
			[/^npm view\b/, "从 npm 核对最终发布版本"],
		],
		unknownCommandPurpose: "完成当前目标所需的验证或处理",
		stageForTool: {
			read: "定位和核对相关材料",
			edit: "执行最小必要修改",
			write: "执行最小必要修改",
			bash: "运行命令并核对结果",
			powershell: "运行命令并核对结果",
		},
		nextEvidence: "基于证据判断方案",
		nextVerify: "补充验证",
		nextCommand: "根据命令结果决定是否继续",
		confirmedGoal: "已收到目标",
		confirmedRead: "已查看相关项目资料",
		confirmedEdit: "已完成代码层面的变更",
		confirmedEditError: "修改步骤需要复核",
		confirmedCommand: "已执行验证命令",
		confirmedCommandError: "命令结果需要处理",
		judgementSmallChange: "优先做小改动，避免扩大范围",
		judgementRecover: "可安全恢复的问题会先处理并继续推进",
		stageError: "处理异常结果",
		stageContinue: "继续核对并收敛结果",
		stageReply: "组织回复",
		nextResult: "给出结论和已做验证",
		detailsOn: (scope) => `已展开细节（${scope}）。高级控制：/fast、/prewalk、/workflow。`,
		detailsOff: (scope) => `已切回紧凑模式（${scope}）。`,
		detailScopeRemember: "已设为所有会话默认",
		detailScopeSession: "仅当前会话",
		detailsStatus: (current, saved) => `当前：${current}。默认：${saved}。`,
		detailsUsage: "用法：/details [on|off|remember|remember compact|status]",
		languageSet: (language) => `已设置语言：${language}。`,
		languageStatus: (current, saved) => `当前语言：${current}。默认语言：${saved}。`,
		languageUsage: "用法：/language [auto|zh|en|status]",
		routeNotice: (route) =>
			`当前类别：${route.kind}。当前偏好：主动程度 ${route.preferences.autonomy}，交付 ${route.preferences.delivery}。`,
		taskKind: (kind) => `任务类型：${kind}`,
		confirmKeyActions: "关键动作会先确认",
	},
	en: {
		initialWorking: "Confirming the goal and boundaries…",
		stageLabels: {
			think: "BYZ thinking",
			goal: "confirming the goal and boundaries",
			inspect: "checking the relevant material",
			modify: "making the smallest necessary change",
			command: "running a command and checking the result",
			recover: "handling an unexpected result",
			reply: "preparing the reply",
			other: "checking and narrowing the result",
		},
		stageShortLabels: {
			think: "BYZ thinking",
			goal: "confirming goal",
			inspect: "checking material",
			modify: "making changes",
			command: "running checks",
			recover: "handling issue",
			reply: "preparing reply",
			other: "checking result",
		},
		timingWorking: ({ shortStage, stageElapsed, active, waiting }) =>
			`Working · ${shortStage} · ${stageElapsed}\nActive ${active} · waiting ${waiting}`,
		timingLines: ({ shortStage, stageElapsed, active, waiting }) => [
			`Current time: ${shortStage} ${stageElapsed}`,
			`Total: active ${active} · waiting ${waiting}`,
		],
		timingSummary: ({ stages, active, waiting, total }) =>
			`Time: ${stages}. Active ${active}; waiting ${waiting}; total ${total}.`,
		defaultGoal: "current task",
		stageConfirm: "confirming the goal and boundaries",
		defaultNext: ["run the needed checks", "summarize the result for you"],
		defaultSafeguards: [
			"I will not take high-risk actions without approval",
			"I will stop only when a human decision is needed",
		],
		fallbackActivity: "Turning the technical steps into a readable update",
		compactLines: ({ state, activity, next, boundary }) => [
			`Working on: ${state.goal}`,
			`Progress: ${activity}`,
			`Next: ${next}`,
			`Boundary: ${boundary}`,
		],
		detailLines: ({ state, activity }) => {
			const lines = [`Working on: ${state.goal}`, `Current stage: ${state.stage}`, `Progress: ${activity}`];
			if (state.confirmed.length > 0) lines.push(`Confirmed: ${state.confirmed.join("; ")}`);
			if (state.judgements.length > 0) lines.push(`Judgement: ${state.judgements.join("; ")}`);
			if (state.nextSteps.length > 0) lines.push(`Next: ${state.nextSteps.join("; ")}`);
			if (state.safeguards.length > 0) lines.push(`Boundary: ${state.safeguards.join("; ")}`);
			return lines;
		},
		readActivity: (target) => `Read ${target ?? "the relevant file"} to decide the next step from real context.`,
		editActivity: (target, isError) =>
			`${isError ? "Tried to edit" : "Edited"} ${target ?? "the relevant file"} to fix the issue with the smallest safe change.`,
		writeActivity: (target, isError) =>
			`${isError ? "Tried to write" : "Wrote"} ${target ?? "the file"} to add what this goal needs.`,
		commandActivity: (command) => `Ran ${command.label} to ${command.purpose}.`,
		toolActivity: (toolName) => `Handled ${toolName} to move the task forward.`,
		commandPurposes: [
			[/^npm run check\b/, "confirm formatting, types, and repository rules pass"],
			[/^npm run build:byz(?::offline)?\b/, "build the BYZ release artifact and verify packaging works"],
			[/^npm --prefix packages\/byz test\b/, "run BYZ tests and confirm existing behavior still works"],
			[/^node --test\b/, "run the targeted regression tests for this fix"],
			[/^npm run release:byz\b/, "create the BYZ release artifact and run pre-publish checks"],
			[/^git status\b/, "make sure only this task's files are being handled"],
			[/^git add\b/, "stage only the files changed for this task"],
			[/^git commit\b/, "record the change so it can be published and rolled back"],
			[/^git push\b/, "send the verified change to the remote and trigger publishing"],
			[/^gh run watch\b/, "wait for the online release workflow to finish"],
			[/^npm view\b/, "verify the final version on npm"],
		],
		unknownCommandPurpose: "complete the verification or processing needed for this goal",
		stageForTool: {
			read: "checking the relevant material",
			edit: "making the smallest necessary change",
			write: "making the smallest necessary change",
			bash: "running a command and checking the result",
			powershell: "running a command and checking the result",
		},
		nextEvidence: "decide from evidence",
		nextVerify: "verify the change",
		nextCommand: "use the command result to decide the next step",
		confirmedGoal: "goal received",
		confirmedRead: "checked the relevant project material",
		confirmedEdit: "completed the code-level change",
		confirmedEditError: "the edit needs review",
		confirmedCommand: "ran the verification command",
		confirmedCommandError: "the command result needs handling",
		judgementSmallChange: "prefer a small change and avoid expanding scope",
		judgementRecover: "I will fix safely recoverable issues and keep moving",
		stageError: "handling an unexpected result",
		stageContinue: "checking and narrowing the result",
		stageReply: "preparing the reply",
		nextResult: "share the conclusion and verification",
		detailsOn: (scope) => `Details are on (${scope}). Advanced controls: /fast, /prewalk, /workflow.`,
		detailsOff: (scope) => `Compact mode is on (${scope}).`,
		detailScopeRemember: "saved as the default for all sessions",
		detailScopeSession: "this session only",
		detailsStatus: (current, saved) => `Current: ${current}. Default: ${saved}.`,
		detailsUsage: "Usage: /details [on|off|remember|remember compact|status]",
		languageSet: (language) => `Language set to: ${language}.`,
		languageStatus: (current, saved) => `Current language: ${current}. Default language: ${saved}.`,
		languageUsage: "Usage: /language [auto|zh|en|status]",
		routeNotice: (route) =>
			`Category: ${route.kind}. Preferences: autonomy ${route.preferences.autonomy}, delivery ${route.preferences.delivery}.`,
		taskKind: (kind) => `task type: ${kind}`,
		confirmKeyActions: "key actions will be confirmed first",
	},
};

function textFor(language) {
	return TEXT[language === LANGUAGE_EN ? LANGUAGE_EN : LANGUAGE_ZH];
}

function formatTokens(count) {
	if (count < 1000) return String(count);
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

const TURN_USAGE_FIELDS = ["input", "output", "cacheRead", "cacheWrite"];

function normalizeObservedUsage(value) {
	if (!value || typeof value !== "object") return undefined;
	const usage = {};
	for (const field of TURN_USAGE_FIELDS) {
		const count = value[field];
		if (Number.isSafeInteger(count) && count >= 0) usage[field] = count;
	}
	return Object.keys(usage).length > 0 ? usage : undefined;
}

function addObservedUsage(target, source, invalidFields) {
	if (!source) return;
	for (const field of TURN_USAGE_FIELDS) {
		if (invalidFields.has(field) || source[field] === undefined) continue;
		const total = (target[field] ?? 0) + source[field];
		if (!Number.isSafeInteger(total)) {
			delete target[field];
			invalidFields.add(field);
		} else {
			target[field] = total;
		}
	}
}

function usageSignature(usage) {
	return TURN_USAGE_FIELDS.map((field) => `${field}:${usage?.[field] ?? "-"}`).join("|");
}

function createTurnUsage() {
	let committed = {};
	let invalidFields = new Set();
	let current;

	function snapshot() {
		const usage = { ...committed };
		addObservedUsage(usage, current, new Set(invalidFields));
		return Object.keys(usage).length > 0 ? Object.freeze(usage) : undefined;
	}

	function changedAfter(update) {
		const before = usageSignature(snapshot());
		update();
		return before !== usageSignature(snapshot());
	}

	return Object.freeze({
		update(value) {
			const usage = normalizeObservedUsage(value);
			if (!usage) return false;
			return changedAfter(() => {
				current = usage;
			});
		},
		commit(role, value) {
			if (role !== "assistant" && role !== "toolResult") return false;
			return changedAfter(() => {
				const usage = normalizeObservedUsage(value) ?? (role === "assistant" ? current : undefined);
				addObservedUsage(committed, usage, invalidFields);
				if (role === "assistant") current = undefined;
			});
		},
		override(value) {
			const usage = normalizeObservedUsage(value);
			if (!usage) return false;
			return changedAfter(() => {
				committed = usage;
				invalidFields = new Set();
				current = undefined;
			});
		},
		snapshot,
	});
}

function createTurnExecution() {
	const inFlightTools = new Map();
	const startedToolIds = new Set();
	const endedToolIds = new Set();
	let sequence = 0;
	let toolCalls = 0;
	let toolFailures = 0;
	let recoverPending = false;
	let replyActive = false;

	function validToolCallId(value) {
		return typeof value === "string" && value.length > 0;
	}

	function selectedStage() {
		if (inFlightTools.size > 0) {
			let latest;
			for (const tool of inFlightTools.values()) {
				if (!latest || tool.sequence > latest.sequence) latest = tool;
			}
			return latest?.stage ?? "think";
		}
		if (recoverPending) return "recover";
		if (replyActive) return "reply";
		return "think";
	}

	return Object.freeze({
		start(toolCallId, toolName) {
			if (!validToolCallId(toolCallId) || startedToolIds.has(toolCallId) || endedToolIds.has(toolCallId))
				return false;
			startedToolIds.add(toolCallId);
			sequence += 1;
			inFlightTools.set(toolCallId, { sequence, stage: stageForTool(toolName), toolName });
			if (toolCalls < Number.MAX_SAFE_INTEGER) toolCalls += 1;
			replyActive = false;
			return true;
		},
		end(toolCallId, isError) {
			if (!validToolCallId(toolCallId)) return undefined;
			const tool = inFlightTools.get(toolCallId);
			if (!tool || endedToolIds.has(toolCallId)) return undefined;
			inFlightTools.delete(toolCallId);
			endedToolIds.add(toolCallId);
			if (isError) {
				if (toolFailures < Number.MAX_SAFE_INTEGER) toolFailures += 1;
				recoverPending = true;
			}
			return tool;
		},
		observeReply() {
			replyActive = true;
			if (inFlightTools.size === 0) recoverPending = false;
		},
		selectedStage,
		snapshot() {
			return Object.freeze({
				inFlightCount: inFlightTools.size,
				selectedStage: selectedStage(),
				toolCalls,
				toolFailures,
			});
		},
	});
}

function formatTurnUsageHeadline(usage, language) {
	const label = language === LANGUAGE_EN ? "Tokens" : "Token";
	if (usage?.input === undefined || usage.output === undefined) return `${label} —`;
	const total = usage.input + usage.output;
	return Number.isSafeInteger(total) ? `${label} ${formatTokens(total)}` : `${label} —`;
}

function formatTurnUsageSummary(usage, language) {
	if (!usage) return language === LANGUAGE_EN ? "Tokens —" : "Token —";
	const labels =
		language === LANGUAGE_EN
			? { input: "input", output: "output", cacheRead: "cache read", cacheWrite: "cache write" }
			: { input: "输入", output: "输出", cacheRead: "缓存读取", cacheWrite: "缓存写入" };
	const parts = TURN_USAGE_FIELDS.flatMap((field) =>
		usage[field] === undefined ? [] : [`${labels[field]} ${formatTokens(usage[field])}`],
	);
	if (parts.length === 0) return language === LANGUAGE_EN ? "Tokens —" : "Token —";
	return `${language === LANGUAGE_EN ? "Tokens: " : "Token："}${parts.join(language === LANGUAGE_EN ? "; " : "；")}`;
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

function normalizeThinkingLevel(level) {
	return THINKING_LEVELS.has(level) ? level : "off";
}

function createByzFooter(ctx, tui, theme, footerData, getThinkingLevel) {
	const unsubscribe = footerData.onBranchChange?.(() => tui.requestRender?.());
	return {
		invalidate() {
			tui.requestRender?.();
		},
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
			const thinkingText = `thinking ${normalizeThinkingLevel(getThinkingLevel())}`;
			const rightText = `${modelText}  ${thinkingText}`;
			const minGap = 2;
			let line;
			if (leftText.length + minGap + rightText.length <= safeWidth) {
				line = `${leftText}${" ".repeat(safeWidth - leftText.length - rightText.length)}${rightText}`;
			} else if (rightText.length + minGap < safeWidth) {
				const leftBudget = Math.max(1, safeWidth - minGap - rightText.length);
				line = `${truncateText(leftText, leftBudget)}${" ".repeat(minGap)}${rightText}`;
			} else {
				line = truncateText(rightText, safeWidth);
			}
			return [theme.fg?.("dim", line) ?? line];
		},
	};
}

function createProgressState(language = LANGUAGE_ZH) {
	const text = textFor(language);
	return {
		goal: text.defaultGoal,
		language,
		stage: text.stageConfirm,
		stageId: "goal",
		confirmed: [],
		judgements: [],
		nextSteps: [...text.defaultNext],
		safeguards: [...text.defaultSafeguards],
		activities: [],
		tools: { inspected: 0, edited: 0, commands: 0 },
		visible: false,
	};
}

function pushUnique(list, value, limit = 3) {
	if (!value || list.includes(value)) return;
	list.push(value);
	if (list.length > limit) list.shift();
}

function summarizeGoal(prompt, language = LANGUAGE_ZH) {
	const clean = String(prompt ?? "")
		.replace(/[\r\n\t]/g, " ")
		.replace(/(展开细节|查看细节|显示细节|show details|details)[，,；;\s]*/gi, "")
		.replace(/ +/g, " ")
		.trim();
	if (!clean) return textFor(language).defaultGoal;
	return clean.length > 28 ? `${clean.slice(0, 27)}…` : clean;
}

function getActivitySummary(state) {
	return state.activities.at(-1) ?? textFor(state.language).fallbackActivity;
}

function getToolTarget(args) {
	if (!args || typeof args !== "object") return undefined;
	return args.path ?? args.file_path ?? args.command;
}

function describeCommand(command, language = LANGUAGE_ZH) {
	const text = String(command ?? "").trim();
	const copy = textFor(language);
	const purpose = copy.commandPurposes.find(([pattern]) => pattern.test(text))?.[1] ?? copy.unknownCommandPurpose;
	return { label: text.split(/\s+/).slice(0, 4).join(" "), purpose };
}

function describeToolActivity(toolName, args, isError, language = LANGUAGE_ZH) {
	const target = getToolTarget(args);
	const copy = textFor(language);
	if (toolName === "read") return copy.readActivity(target);
	if (toolName === "edit") return copy.editActivity(target, isError);
	if (toolName === "write") return copy.writeActivity(target, isError);
	if (toolName === "bash" || toolName === "powershell")
		return copy.commandActivity(describeCommand(args?.command, language));
	return copy.toolActivity(toolName);
}

function timingValues(state, snapshot) {
	const copy = textFor(state.language);
	const language = state.language;
	return {
		active: formatElapsed(snapshot.activeMs, language),
		stage: copy.stageLabels[snapshot.currentStage] ?? copy.stageLabels.other,
		shortStage: copy.stageShortLabels[snapshot.currentStage] ?? copy.stageShortLabels.other,
		stageElapsed: formatElapsed(snapshot.currentStageMs, language),
		waiting: formatElapsed(snapshot.waitingMs, language),
	};
}

function renderProgressCard(state, snapshot, usage, execution, options = {}) {
	const copy = textFor(state.language);
	if (options.compact) {
		const executionCopy = EXECUTION_TEXT[state.language];
		const stage = snapshot.waiting ? "waiting" : execution.selectedStage;
		const parts = [executionCopy.status[stage] ?? executionCopy.status.think];
		if (execution.inFlightCount > 0) parts.push(executionCopy.runningTools(execution.inFlightCount));
		parts.push(formatElapsed(snapshot.totalMs, state.language), formatTurnUsageHeadline(usage, state.language));
		return parts.join(" · ");
	}
	const activity = getActivitySummary(state);
	return [
		...copy.detailLines({ state, activity }),
		...copy.timingLines(timingValues(state, snapshot)),
		formatTurnUsageSummary(usage, state.language),
	].join("\n");
}

function renderTimingSummary(state, snapshot, usage, execution) {
	const language = state.language;
	const executionCopy = EXECUTION_TEXT[language];
	const modelActiveMs = snapshot.stages.reduce(
		(sum, entry) => (MODEL_ACTIVE_STAGES.has(entry.stage) ? sum + entry.milliseconds : sum),
		0,
	);
	const firstLine = [
		executionCopy.completion,
		formatElapsed(snapshot.totalMs, language),
		formatTurnUsageHeadline(usage, language),
	].join(" · ");
	const secondLine = [executionCopy.modelActive(formatElapsed(modelActiveMs, language))];
	if (execution.toolCalls > 0) secondLine.push(executionCopy.toolSummary(execution.toolCalls, execution.toolFailures));
	if (snapshot.waitingMs > 0)
		secondLine.push(executionCopy.waitingSummary(formatElapsed(snapshot.waitingMs, language)));
	return `${firstLine}\n${secondLine.join(" · ")}`;
}

function stageForTool(toolName) {
	if (["read", "grep", "find", "ls"].includes(toolName)) return "inspect";
	if (["edit", "write"].includes(toolName)) return "modify";
	if (["bash", "powershell"].includes(toolName)) return "command";
	return "other";
}

function setProgressStage(state, stageId) {
	state.stageId = stageId;
	state.stage = textFor(state.language).stageLabels[stageId] ?? textFor(state.language).stageLabels.other;
}

function updateProgressFromToolStart(state, toolName) {
	const copy = textFor(state.language);
	if (["read", "grep", "find", "ls"].includes(toolName)) {
		pushUnique(state.nextSteps, copy.nextEvidence);
	} else if (["edit", "write"].includes(toolName)) {
		pushUnique(state.judgements, copy.judgementSmallChange);
		pushUnique(state.nextSteps, copy.nextVerify);
	} else if (["bash", "powershell"].includes(toolName)) {
		pushUnique(state.nextSteps, copy.nextCommand);
	}
}

function updateProgressFromToolEnd(state, toolName, args, isError) {
	const copy = textFor(state.language);
	pushUnique(state.activities, describeToolActivity(toolName, args, isError, state.language), 4);
	if (["read", "grep", "find", "ls"].includes(toolName)) {
		state.tools.inspected += 1;
		pushUnique(state.confirmed, copy.confirmedRead);
	} else if (["edit", "write"].includes(toolName)) {
		state.tools.edited += 1;
		pushUnique(state.confirmed, isError ? copy.confirmedEditError : copy.confirmedEdit);
	} else if (["bash", "powershell"].includes(toolName)) {
		state.tools.commands += 1;
		pushUnique(state.confirmed, isError ? copy.confirmedCommandError : copy.confirmedCommand);
	}
	if (isError) pushUnique(state.judgements, copy.judgementRecover);
}

export function createConversationExtension(options = {}) {
	const policy = createInteractionPolicy();
	const routingPolicy = createRoutingPolicy();
	const progressCardDelayMs = options.progressCardDelayMs ?? 2_000;
	const now = options.now ?? (() => performance.now());
	const scheduleInterval = options.setInterval ?? setInterval;
	const cancelInterval = options.clearInterval ?? clearInterval;
	let savedDetailMode = getSavedDetailMode();
	let savedLanguage = getSavedLanguage();
	let currentLanguage = detectLanguage("", savedLanguage);

	return function conversationExtension(ports) {
		let progressTimer;
		let elapsedTimer;
		let turnGeneration = 0;
		let turnTiming;
		let turnUsage;
		let turnExecution;
		let footerComponent;
		let currentThinkingLevel = "off";
		let progressState = createProgressState(currentLanguage);
		let activeCtx;

		function clearProgressTimer() {
			if (progressTimer !== undefined) clearTimeout(progressTimer);
			progressTimer = undefined;
		}

		function clearElapsedTimer() {
			if (elapsedTimer !== undefined) cancelInterval(elapsedTimer);
			elapsedTimer = undefined;
		}

		function syncSelectedStage() {
			if (!turnTiming || !turnExecution) return false;
			const stage = turnExecution.selectedStage();
			if (progressState.stageId === stage) return false;
			setProgressStage(progressState, stage);
			turnTiming.transition(stage);
			return true;
		}

		function publishWorking() {
			if (!activeCtx || !turnTiming || !turnExecution || !progressState.visible) return;
			activeCtx.ui.setWorkingMessage?.(
				renderProgressCard(progressState, turnTiming.snapshot(), turnUsage?.snapshot(), turnExecution.snapshot(), {
					compact: !policy.isDetailEnabled(),
				}),
			);
		}

		function publishProgress() {
			progressTimer = undefined;
			if (!activeCtx || !turnTiming) return;
			progressState.visible = true;
			publishWorking();
		}

		function finishTurn(options = {}) {
			turnGeneration += 1;
			clearProgressTimer();
			clearElapsedTimer();
			const usage = turnUsage?.snapshot();
			const execution = turnExecution?.snapshot();
			turnUsage = undefined;
			turnExecution = undefined;
			if (!turnTiming || !execution) {
				turnTiming = undefined;
				return;
			}
			const snapshot = turnTiming.finish();
			if (options.notify && activeCtx)
				activeCtx.ui.notify(renderTimingSummary(progressState, snapshot, usage, execution), "info");
			turnTiming = undefined;
		}

		ports.on("session_start", (_event, ctx) => {
			routingPolicy.reset();
			policy.setDetailEnabled(savedDetailMode === DETAIL_MODE_DETAILS);
			currentThinkingLevel = normalizeThinkingLevel(ctx.thinkingLevel);
			ctx.ui.setTitle?.("BYZ");
			ctx.ui.setMessagePresenter?.((message) => policy.presentAssistantMessage(message));
			ctx.ui.setToolExecutionVisible?.(policy.isDetailEnabled());
			ctx.ui.setFooter?.((tui, theme, footerData) => {
				footerComponent = createByzFooter(ctx, tui, theme, footerData, () => currentThinkingLevel);
				return footerComponent;
			});
			ctx.ui.setConfirmationPresenter?.(async ({ title, message, confirm }) => {
				const generation = turnGeneration;
				turnTiming?.pauseForConfirmation();
				publishWorking();
				try {
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
					return await confirm();
				} finally {
					if (generation === turnGeneration) {
						turnTiming?.resumeAfterConfirmation();
						publishWorking();
					}
				}
			});
			ctx.ui.notify(WELCOME, "info");
		});
		ports.on("thinking_level_select", (event) => {
			currentThinkingLevel = normalizeThinkingLevel(event.level);
			footerComponent?.invalidate();
		});
		ports.on("agent_start", (_event, ctx) => {
			activeCtx = ctx;
			policy.resetProgress();
			progressState.visible = false;
			clearProgressTimer();
			clearElapsedTimer();
			turnGeneration += 1;
			const generation = turnGeneration;
			turnTiming = createTurnTiming({ now });
			turnUsage = createTurnUsage();
			turnExecution = createTurnExecution();
			setProgressStage(progressState, "think");
			turnTiming.start("think");
			elapsedTimer = scheduleInterval(() => {
				if (generation === turnGeneration) publishWorking();
			}, 1_000);
			progressTimer = setTimeout(() => {
				if (generation !== turnGeneration) return;
				publishProgress();
			}, progressCardDelayMs);
		});
		ports.on("tool_execution_start", (event) => {
			if (!turnExecution?.start(event.toolCallId, event.toolName)) return;
			updateProgressFromToolStart(progressState, event.toolName);
			syncSelectedStage();
			publishWorking();
		});
		ports.on("tool_execution_end", (event) => {
			const tool = turnExecution?.end(event.toolCallId, event.isError);
			if (!tool) return;
			updateProgressFromToolEnd(progressState, tool.toolName, event.args, event.isError);
			syncSelectedStage();
			publishWorking();
		});
		ports.on("message_update", (event) => {
			if (event.message?.role !== "assistant") return;
			const copy = textFor(progressState.language);
			const usageChanged = turnUsage?.update(event.message.usage) ?? false;
			turnExecution?.observeReply();
			const stageChanged = syncSelectedStage();
			pushUnique(progressState.nextSteps, copy.nextResult);
			if (stageChanged || usageChanged) publishWorking();
		});
		ports.on("message_end", (event) => {
			if (turnUsage?.commit(event.message?.role, event.message?.usage)) publishWorking();
		});
		ports.on("agent_end", (event) => {
			turnUsage?.override(event.usage);
			finishTurn({ notify: true });
			activeCtx?.ui.setWorkingMessage?.();
			activeCtx = undefined;
		});
		ports.on("session_shutdown", () => {
			routingPolicy.reset();
			footerComponent = undefined;
			finishTurn();
			activeCtx?.ui.setWorkingMessage?.();
			activeCtx = undefined;
		});
		function applyDetailMode(ctx, mode, options = {}) {
			const copy = textFor(currentLanguage);
			policy.setDetailEnabled(mode === DETAIL_MODE_DETAILS);
			ctx.ui.setToolExecutionVisible?.(policy.isDetailEnabled());
			if (options.remember) {
				saveDetailMode(mode);
				savedDetailMode = mode;
			}
			const scope = options.remember ? copy.detailScopeRemember : copy.detailScopeSession;
			ctx.ui.notify(mode === DETAIL_MODE_DETAILS ? copy.detailsOn(scope) : copy.detailsOff(scope), "info");
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
				ctx.ui.notify(textFor(currentLanguage).detailsStatus(current, savedDetailMode), "info");
				return;
			}
			ctx.ui.notify(textFor(currentLanguage).detailsUsage, "warning");
		}

		function applyLanguage(language, ctx) {
			currentLanguage = detectLanguage("", language);
			savedLanguage = language;
			saveLanguage(language);
			progressState.language = currentLanguage;
			ctx.ui.notify(textFor(currentLanguage).languageSet(language), "info");
		}

		function handleLanguageCommand(args, ctx) {
			const action = String(args ?? "")
				.trim()
				.toLowerCase();
			if ([LANGUAGE_AUTO, LANGUAGE_ZH, LANGUAGE_EN].includes(action)) {
				applyLanguage(action, ctx);
				return;
			}
			if (action === "status") {
				ctx.ui.notify(textFor(currentLanguage).languageStatus(currentLanguage, savedLanguage), "info");
				return;
			}
			ctx.ui.notify(textFor(currentLanguage).languageUsage, "warning");
		}

		ports.registerCommand("details", {
			description: "Configure BYZ detail mode",
			handler: async (args, ctx) => handleDetailsCommand(args, ctx),
		});
		ports.registerCommand("language", {
			description: "Configure BYZ language",
			handler: async (args, ctx) => handleLanguageCommand(args, ctx),
		});
		ports.on("before_agent_start", async (event, ctx) => {
			currentLanguage = detectLanguage(event.prompt, savedLanguage);
			const copy = textFor(currentLanguage);
			const route = routingPolicy.route(event.prompt);
			progressState = createProgressState(currentLanguage);
			progressState.goal = summarizeGoal(event.prompt, currentLanguage);
			pushUnique(progressState.confirmed, copy.confirmedGoal);
			pushUnique(progressState.judgements, copy.judgementRecover);
			if (route.kind !== "general") pushUnique(progressState.judgements, copy.taskKind(route.kind));
			if (route.preferences.autonomy === "confirm-key-actions") {
				pushUnique(progressState.safeguards, copy.confirmKeyActions);
			}
			if (route.details || parseConversationControl(event.prompt) === "detail") {
				applyDetailMode(ctx, DETAIL_MODE_DETAILS);
			}
			if (policy.isDetailEnabled()) {
				ctx.ui.notify(copy.routeNotice(route), "info");
			}
			return {
				systemPrompt: `${event.systemPrompt ?? ""}\n\nBYZ collaboration guidance for this turn:\n${route.instructions}`,
			};
		});
	};
}

export { WELCOME };
