import { markNoticeShown, wasNoticeShown } from "./config.js";
import { bucketDuration, mapHttpStatus, mapMode, mapProvider, mapStopReason, mapTool } from "./schema.js";

const NOTICE =
	"BYZ 本地诊断已开启：仅保存在本机，不上传，也不记录 Prompt、代码、路径或工具内容。可运行 `byz diagnostics disable` 关闭。";

function lastStopReason(messages) {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role === "assistant") return mapStopReason(message.stopReason);
	}
	return "unknown";
}

export function createDiagnosticsExtension(options) {
	const { recorder } = options;
	const mode = options.mode ?? mapMode([]);
	const home = options.home;
	return function diagnosticsExtension(ports) {
		let agentStartedAt;
		let noticePending = false;
		let noticeTimer;
		const modelStarts = [];
		const toolStarts = new Map();

		ports.on("session_start", (_event, ctx) => {
			if (mode !== "interactive" || !recorder.enabled || noticePending || wasNoticeShown(home)) return;
			noticePending = true;
			noticeTimer = setTimeout(() => {
				noticeTimer = undefined;
				if (wasNoticeShown(home)) return;
				ctx.ui.notify(NOTICE, "info");
				markNoticeShown(home);
			}, 100);
		});
		ports.on("agent_start", () => {
			agentStartedAt = performance.now();
		});
		ports.on("agent_end", (event) => {
			recorder.record("byz.agent.run", {
				mode,
				outcome: lastStopReason(event.messages) === "error" ? "error" : "ok",
				stop_reason: lastStopReason(event.messages),
				duration_bucket: bucketDuration(
					agentStartedAt === undefined ? undefined : performance.now() - agentStartedAt,
				),
			});
			agentStartedAt = undefined;
			while (modelStarts.length > 0) {
				const pending = modelStarts.shift();
				recorder.record("byz.model.request", {
					provider_category: pending.provider,
					outcome: "error",
					http_status_class: "network_error",
					stop_reason: "unpaired",
					duration_bucket: bucketDuration(performance.now() - pending.startedAt),
				});
			}
		});
		ports.on("before_provider_request", (_event, ctx) => {
			modelStarts.push({ startedAt: performance.now(), provider: mapProvider(ctx.model?.provider) });
		});
		ports.on("after_provider_response", (event) => {
			const pending = modelStarts.shift();
			recorder.record("byz.model.request", {
				provider_category: pending?.provider ?? "unknown",
				outcome: event.status >= 400 ? "error" : "ok",
				http_status_class: mapHttpStatus(event.status),
				stop_reason: "unknown",
				duration_bucket: bucketDuration(pending ? performance.now() - pending.startedAt : undefined),
			});
		});
		ports.on("tool_execution_start", (event) => {
			toolStarts.set(event.toolCallId, performance.now());
		});
		ports.on("tool_execution_end", (event) => {
			const startedAt = toolStarts.get(event.toolCallId);
			toolStarts.delete(event.toolCallId);
			recorder.record("byz.tool.execution", {
				tool: mapTool(event.toolName),
				outcome: event.isError ? "error" : "ok",
				duration_bucket: bucketDuration(startedAt === undefined ? undefined : performance.now() - startedAt),
			});
		});
		ports.on("session_shutdown", () => {
			if (noticeTimer) clearTimeout(noticeTimer);
			noticeTimer = undefined;
			noticePending = false;
			toolStarts.clear();
			modelStarts.length = 0;
		});
	};
}

export { NOTICE as DIAGNOSTICS_NOTICE };
