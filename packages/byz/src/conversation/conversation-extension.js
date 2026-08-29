import { createInteractionPolicy, formatDecision, parseConversationControl } from "./interaction-policy.js";

const WELCOME = "BYZ\n\n你想让我帮你做什么？";

export function createConversationExtension() {
	const policy = createInteractionPolicy();

	return function conversationExtension(pi) {
		let progressTimer;

		function clearProgressTimer() {
			if (progressTimer) clearTimeout(progressTimer);
			progressTimer = undefined;
		}

		pi.on("session_start", (_event, ctx) => {
			ctx.ui.setTitle?.("BYZ");
			ctx.ui.setMessagePresenter?.((message) => policy.presentAssistantMessage(message));
			ctx.ui.setToolExecutionVisible?.(false);
			ctx.ui.setFooter?.(() => ({
				invalidate() {},
				render() {
					return [];
				},
			}));
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
			policy.resetProgress();
			clearProgressTimer();
			progressTimer = setTimeout(() => {
				const message = policy.present("progress", "");
				if (message) ctx.ui.setWorkingMessage?.(message);
			}, 30_000);
		});
		pi.on("agent_end", () => {
			clearProgressTimer();
		});
		pi.on("session_shutdown", () => {
			clearProgressTimer();
		});
		function showDetails(ctx) {
			policy.setDetailEnabled(true);
			ctx.ui.setToolExecutionVisible?.(true);
			ctx.ui.notify("已展开细节。高级控制：/fast、/prewalk、/workflow。", "info");
		}

		pi.registerCommand("details", {
			description: "Show BYZ advanced controls",
			handler: async (_args, ctx) => showDetails(ctx),
		});
		pi.on("before_agent_start", async (event, ctx) => {
			if (parseConversationControl(event.prompt) === "detail") showDetails(ctx);
		});
	};
}

export { WELCOME };
