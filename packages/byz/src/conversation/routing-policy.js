const DEFAULT_PREFERENCES = Object.freeze({
	autonomy: "balanced",
	delivery: "normal",
});

const CONTROL_PATTERNS = [
	[/关键动作先问我|先问我/, { autonomy: "confirm-key-actions" }],
	[/少问一点/, { autonomy: "fewer-questions" }],
	[/直接做/, { autonomy: "direct" }],
	[/先给三个方向/, { delivery: "three-directions" }],
	[/展开细节|查看细节|显示细节/, {}],
];

const FALLBACKS = Object.freeze({
	research: {
		missingInput: "需要可访问链接、正文、关键词或目标来源。",
		fallback: "可先基于你提供的摘要做初步判断，或请你补充正文、截图、链接。",
	},
	"bug-fix": {
		missingInput: "需要复现步骤、报错信息、相关输入或运行环境。",
		fallback: "可先根据现象列排查清单，等你补充日志后再定位。",
	},
	"project-recovery": {
		missingInput: "需要当前项目路径、上次进度、任务状态或错误现场。",
		fallback: "可先读取本地项目状态并汇总可恢复线索。",
	},
	general: {
		missingInput: "需要更明确的目标、输入材料或期望输出。",
		fallback: "可先给出可选方向或最小可执行下一步。",
	},
});

function classify(goal) {
	if (/https?:\/\/|链接|帖子|查一下|调研|研究/.test(goal)) return "research";
	if (/三个方向|创意|设计|文案|写作|起个名字/.test(goal)) return "creative";
	if (/报错|bug|缺陷|无法复现|修复/.test(goal)) return "bug-fix";
	if (/新功能|实现|开发|增加.*功能|添加.*功能/.test(goal)) return "feature";
	if (/继续.*项目|恢复.*项目|上次.*停/.test(goal)) return "project-recovery";
	return "general";
}

function instructionsFor(kind, preferences) {
	const collaboration = [
		preferences.autonomy === "direct" ? "在安全且可逆的范围内直接推进，不要先要求用户选择内部模式。" : undefined,
		preferences.autonomy === "fewer-questions" ? "仅在缺少会明显改变结果的关键信息时提一个问题。" : undefined,
		preferences.autonomy === "confirm-key-actions" ? "关键动作前说明影响并请求确认。" : undefined,
		preferences.delivery === "three-directions" ? "先给出三个可区分的方向，再建议一个推荐方向。" : undefined,
	].filter(Boolean);
	const task = {
		research: "优先说明来源是否可访问；无法取得内容时说明缺失并建议用户提供正文或替代来源。",
		creative: "先给出可见的创作骨架或方向，避免暴露内部能力名称。",
		"bug-fix": "先以可复现证据定位；无法复现时说明缺少的环境、输入或日志。",
		feature: "先确认目标与范围；涉及高影响动作时保持既有确认边界。",
		"project-recovery": "只在当前会话可见信息足够时恢复上下文；否则说明需要的项目状态。",
		general: "直接用自然语言处理目标；资料不足时说明未完成部分和可行替代路径。",
	}[kind];
	return [...collaboration, task].join("\n");
}

export function classifyRequest(prompt, preferences = DEFAULT_PREFERENCES) {
	const kind = classify(prompt.trim());
	return {
		fallback: FALLBACKS[kind]?.fallback,
		instructions: instructionsFor(kind, preferences),
		kind,
		missingInput: FALLBACKS[kind]?.missingInput,
	};
}

export function parseSessionPreference(input) {
	const preferences = {};
	const details = /展开细节|查看细节|显示细节/.test(input);
	let goal = input;
	for (const [pattern, changes] of CONTROL_PATTERNS) {
		if (pattern.test(goal)) Object.assign(preferences, changes);
		goal = goal.replace(pattern, "");
	}
	return { details, goal: goal.replace(/[，,。；;]+/g, " ").trim(), preferences };
}

export const parseSessionPreferences = parseSessionPreference;

export function createRoutingPolicy() {
	let preferences = { ...DEFAULT_PREFERENCES };

	return {
		route(input) {
			const parsed = parseSessionPreference(input);
			preferences = { ...preferences, ...parsed.preferences };
			const route = classifyRequest(parsed.goal, preferences);
			return {
				...route,
				details: parsed.details,
				goal: parsed.goal,
				preferences: { ...preferences },
			};
		},
		reset() {
			preferences = { ...DEFAULT_PREFERENCES };
		},
	};
}
