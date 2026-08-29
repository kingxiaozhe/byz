const INTERNAL_TERMS = /\b(?:model|skill|workflow|fast|prewalk|token|tool|step\s*\d+)\b/gi;

export function createInteractionPolicy() {
	let progressShown = false;
	let detailEnabled = false;

	function present(kind, message, { detail = false } = {}) {
		if (kind === "progress") {
			if (progressShown) return undefined;
			progressShown = true;
			return "正在处理，稍后给你结果。";
		}
		if (kind === "advanced-control" && !detailEnabled && !detail) return undefined;
		if (detail || detailEnabled) return message;
		return message.replace(INTERNAL_TERMS, "内部设置");
	}

	function presentAssistantMessage(message) {
		if (detailEnabled) return message;
		const content = message.content
			.filter((part) => part.type === "text")
			.map((part) => ({ ...part, text: part.text.replace(INTERNAL_TERMS, "内部设置") }));
		return { ...message, content };
	}

	return {
		present,
		presentAssistantMessage,
		setDetailEnabled(enabled) {
			detailEnabled = enabled;
		},
		isDetailEnabled() {
			return detailEnabled;
		},
		resetProgress() {
			progressShown = false;
		},
	};
}

export function parseConversationControl(input) {
	const value = input.trim();
	if (/^(展开细节|查看细节|显示细节)$/.test(value)) return "detail";
	if (/^(少问一点|直接做)$/.test(value)) return "proceed";
	if (/^(关键动作先问我|先问我)$/.test(value)) return "confirm";
	if (/^(取消|不要|拒绝)$/.test(value)) return "reject";
	if (/^(确认|继续|同意|可以)$/.test(value)) return "accept";
	return undefined;
}

export function formatDecision({ impact, recommendation, alternative, onReject }) {
	return `需要你决定\n影响：${impact}\n建议：${recommendation}\n其他选择：${alternative}\n如果拒绝：${onReject}`;
}
