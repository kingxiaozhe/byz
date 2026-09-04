export const WELCOME = "BYZ\n\n你想让我帮你做什么？";
export const DETAIL_MODE_COMPACT = "compact";
export const DETAIL_MODE_DETAILS = "details";
export const LANGUAGE_AUTO = "auto";
export const LANGUAGE_ZH = "zh";
export const LANGUAGE_EN = "en";
export const EXECUTION_TEXT = {
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
			paused: "已暂停",
		},
		runningTools: (count) => `${count} 个工具运行`,
		step: (ordinal, total) => `步骤 ${ordinal}/${total}`,
		completed: (completed, total) => `完成 ${completed}/${total}`,
		blocked: (count) => `阻塞 ${count}`,
		verified: (count) => `已验证 ${count}`,
		planDetails: (parts) => `执行计划：${parts.join("；")}`,
		planUnavailable: "执行计划：不可用（invalid_record）",
		completion: "完成",
		modelActive: (elapsed) => `BYZ 思考了 ${elapsed}`,
		toolSummary: (calls, failures) => `工具 ${calls} 次${failures > 0 ? `（${failures} 次失败）` : ""}`,
		waitingSummary: (elapsed) => `等待 ${elapsed}`,
		pauseSummary: (elapsed) => `暂停 ${elapsed}`,
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
			paused: "Paused",
		},
		runningTools: (count) => `${count} ${count === 1 ? "tool" : "tools"} running`,
		step: (ordinal, total) => `Step ${ordinal}/${total}`,
		completed: (completed, total) => `completed ${completed}/${total}`,
		blocked: (count) => `${count} blocked`,
		verified: (count) => `${count} verified`,
		planDetails: (parts) => `Execution plan: ${parts.join("; ")}`,
		planUnavailable: "Execution plan: unavailable (invalid_record)",
		completion: "Done",
		modelActive: (elapsed) => `BYZ thought for ${elapsed}`,
		toolSummary: (calls, failures) =>
			`${calls} ${calls === 1 ? "tool" : "tools"}${failures > 0 ? ` (${failures} failed)` : ""}`,
		waitingSummary: (elapsed) => `waited ${elapsed}`,
		pauseSummary: (elapsed) => `paused ${elapsed}`,
	},
};

export function detectLanguage(input, savedLanguage = LANGUAGE_AUTO) {
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
		preferencesCorrupt: "BYZ 偏好设置已损坏，本次使用安全默认值。",
		preferencesUnavailable: "BYZ 偏好设置不可用，本次使用安全默认值。",
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
		preferencesCorrupt: "BYZ preferences are corrupt; safe defaults are active for this session.",
		preferencesUnavailable: "BYZ preferences are unavailable; safe defaults are active for this session.",
	},
};

export function textFor(language) {
	return TEXT[language === LANGUAGE_EN ? LANGUAGE_EN : LANGUAGE_ZH];
}
