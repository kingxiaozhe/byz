import { formatDecision, parseConversationControl } from "./interaction-policy.js";

export function createConfirmationPresenter(options) {
	return async function presentConfirmation({ title, message, confirm }) {
		const generation = options.getGeneration();
		const pauseGeneration = options.beginConfirmation?.();
		options.getTurnTiming()?.pauseForConfirmation();
		options.publishWorking();
		try {
			const prompt = formatDecision({
				impact: message,
				recommendation: "确认",
				alternative: "取消",
				onReject: "不会执行此操作",
			});
			while (true) {
				const answer = await options.input(prompt, `${title}：输入“确认”或“取消”`);
				if (answer?.trim().toLowerCase().startsWith("/pause")) {
					options.notify?.("Pause is unavailable while confirmation is waiting.", "warning");
					continue;
				}
				const choice = answer ? parseConversationControl(answer) : undefined;
				if (choice === "accept" || choice === "proceed") return true;
				if (choice === "reject") return false;
				return await confirm();
			}
		} finally {
			options.endConfirmation?.(pauseGeneration);
			if (generation === options.getGeneration()) {
				options.getTurnTiming()?.resumeAfterConfirmation();
				options.publishWorking();
			}
		}
	};
}
