import { createInteractionPolicy, formatDecision, parseConversationControl } from "./interaction-policy.js";
import { createRoutingPolicy } from "./routing-policy.js";

const WELCOME = "BYZ\n\n你想让我帮你做什么？";

export function createConversationExtension() {
	const policy = createInteractionPolicy();
	const routingPolicy = createRoutingPolicy();

	return function conversationExtension(pi) {
		let progressTimer;

		function clearProgressTimer() {
			if (progressTimer) clearTimeout(progressTimer);
			progressTimer = undefined;
		}

		pi.on("session_start", (_event, ctx) => {
			routingPolicy.reset();
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
			routingPolicy.reset();
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
			const route = routingPolicy.route(event.prompt);
			if (route.details || parseConversationControl(event.prompt) === "detail") showDetails(ctx);
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
