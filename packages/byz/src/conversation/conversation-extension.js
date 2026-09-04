import { createConversationController } from "./conversation-controller.js";
import { WELCOME } from "./language-catalog.js";

export function createConversationExtension(options = {}) {
	const controllerFactory = options.controllerFactory ?? createConversationController;
	return function conversationExtension(ports) {
		const controller = controllerFactory(options);
		ports.on("session_start", controller.onSessionStart);
		ports.on("thinking_level_select", controller.onThinkingLevelSelect);
		ports.on("agent_start", controller.onAgentStart);
		ports.on("agent_settled", controller.onAgentSettled);
		ports.on("tool_execution_start", controller.onToolExecutionStart);
		ports.on("tool_execution_end", controller.onToolExecutionEnd);
		ports.on("message_update", controller.onMessageUpdate);
		ports.on("message_end", controller.onMessageEnd);
		ports.on("agent_end", controller.onAgentEnd);
		ports.on("session_shutdown", controller.onSessionShutdown);
		ports.on("before_agent_start", controller.onBeforeAgentStart);
		ports.registerCommand("details", {
			description: "Configure BYZ detail mode",
			handler: async (args, ctx) => controller.handleDetailsCommand(args, ctx),
		});
		ports.registerCommand("language", {
			description: "Configure BYZ language",
			handler: async (args, ctx) => controller.handleLanguageCommand(args, ctx),
		});
	};
}

export { WELCOME };
