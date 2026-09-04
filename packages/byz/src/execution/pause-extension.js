import { createPauseController } from "./pause-controller.js";

const USAGE = "Usage: /pause [resume|status|cancel]";
const RECEIPT_STATES = new Set(["requested", "paused", "resuming", "running", "idle", "stale"]);
const RECEIPT_REASONS = new Set(["registry_unavailable", "completed_before_pause", "cancelled", "shutdown", "reload"]);

function durationBucket(milliseconds) {
	if (milliseconds < 1_000) return "<1s";
	if (milliseconds < 10_000) return "<10s";
	if (milliseconds < 60_000) return "<1m";
	return ">=1m";
}

function receiptFor(snapshot) {
	const plan = snapshot.pausedRegistrySnapshot?.plan;
	const waitingMs = Number.isSafeInteger(snapshot.waitingMs) ? snapshot.waitingMs : 0;
	return Object.freeze({
		schemaVersion: 1,
		boundary: snapshot.boundary,
		durationBucket: durationBucket(waitingMs),
		generation: snapshot.generation,
		planId: typeof plan?.id === "string" ? plan.id : undefined,
		...(RECEIPT_REASONS.has(snapshot.reason) ? { reason: snapshot.reason } : {}),
		state: RECEIPT_STATES.has(snapshot.state) ? snapshot.state : "stale",
		taskId: typeof plan?.active?.id === "string" ? plan.active.id : undefined,
	});
}

function closedSnapshot(after, before, reason) {
	return {
		...after,
		boundary: before.boundary,
		pausedRegistrySnapshot: before.pausedRegistrySnapshot,
		reason,
		waitingMs: before.waitingMs,
	};
}

function formatStatus(snapshot) {
	const wait = snapshot.waitingMs > 0 ? `; wait=${snapshot.waitingMs}ms` : "";
	const boundary = snapshot.boundary ? `; boundary=${snapshot.boundary}` : "";
	const plan = snapshot.pausedRegistrySnapshot?.plan;
	const task = plan?.active?.id ? `; task=${plan.active.id}` : "";
	return `Pause: ${snapshot.state}${boundary}${task}${wait}.`;
}

export function createPauseExtension(options = {}) {
	const controller =
		options.controller ??
		createPauseController({
			now: options.now,
			readRegistrySnapshot: () => options.executionRegistry?.snapshot?.(),
			onPause: options.onPause,
			onResume: options.onResume,
		});

	return function pauseExtension(ports) {
		let appendWarningShown = false;
		let activeContext;
		function appendReceipt(snapshot, context) {
			try {
				ports.appendEntry(receiptFor(snapshot));
			} catch {
				if (!appendWarningShown && context) {
					appendWarningShown = true;
					context.ui.notify("Pause state is active, but its audit receipt could not be saved.", "warning");
				}
			}
		}

		controller.subscribe((snapshot) => {
			if (snapshot.state === "paused" || snapshot.reason === "registry_unavailable") {
				appendReceipt(snapshot, activeContext);
			}
			options.onSnapshot?.(snapshot);
		});
		ports.on("session_start", (_event, context) => {
			const entries = context.readPauseEntries();
			const last = entries.at(-1);
			if (
				controller.snapshot().state === "idle" &&
				(last?.state === "requested" || last?.state === "paused" || last?.state === "stale")
			) {
				controller.settle("reload");
			}
		});
		ports.on("agent_start", (_event, context) => {
			activeContext = context;
			controller.startRun();
		});
		ports.on("agent_end", () => {
			// agent_end may be followed by retry, compaction, or a queued continuation.
		});
		ports.on("agent_settled", (_event, context) => {
			const before = controller.snapshot();
			controller.settle("settled");
			if (before.state === "requested" || before.state === "paused") {
				appendReceipt(
					closedSnapshot(
						controller.snapshot(),
						before,
						before.state === "requested" ? "completed_before_pause" : "cancelled",
					),
					context,
				);
				if (before.state === "requested") {
					context.ui.notify(
						"Pause request closed because the run completed before another safe boundary.",
						"info",
					);
				}
			}
		});
		ports.on("session_shutdown", (event, context) => {
			const before = controller.snapshot();
			controller.settle(event.reason === "reload" ? "reload" : "shutdown");
			appendReceipt(
				closedSnapshot(controller.snapshot(), before, event.reason === "reload" ? "reload" : "shutdown"),
				context,
			);
			activeContext = undefined;
		});
		ports.on("tool_batch_start", (event) => {
			controller.admitBatch(event.toolCalls);
		});
		ports.on("tool_execution_start", (event) => {
			controller.toolStarted(event.toolCallId);
		});
		ports.on("tool_execution_end", (event) => {
			controller.toolEnded(event.toolCallId);
		});
		ports.on("tool_call", async (event, context) => {
			if (controller.admitTool(event.toolCallId)) return undefined;
			const state = controller.snapshot().state;
			if (state !== "requested" && state !== "paused") return undefined;
			const outcome = await controller.reachBoundary("tool", context.signal);
			if (outcome === "resumed") {
				controller.admitTool(event.toolCallId);
				return undefined;
			}
			return { block: true, terminate: true, reason: "Pause gate was cancelled." };
		});
		ports.on("model_request_gate", async (_event, context) => {
			const state = controller.snapshot().state;
			if (state !== "requested" && state !== "paused") return;
			const outcome = await controller.reachBoundary("model", context.signal);
			if (outcome !== "resumed") throw new Error("Model request cancelled by pause gate.");
		});
		ports.registerCommand("pause", {
			description: "Pause at the next safe model or tool boundary",
			handler: async (args, context) => {
				const action = String(args ?? "")
					.trim()
					.toLowerCase();
				if (!action) {
					const result = controller.request();
					if (!result.accepted) {
						context.ui.notify(
							result.reason === "confirmation"
								? "Pause is unavailable while confirmation is waiting."
								: "There is no running task to pause.",
							"info",
						);
						return;
					}
					appendReceipt(result.snapshot, context);
					context.ui.notify(
						result.reason === "duplicate"
							? formatStatus(result.snapshot)
							: "Pause requested; waiting for a safe boundary.",
						"info",
					);
					return;
				}
				if (action === "status") {
					context.ui.notify(formatStatus(controller.snapshot()), "info");
					return;
				}
				if (action === "resume") {
					const before = controller.snapshot();
					if (!controller.resume(before.generation)) {
						context.ui.notify("Pause: there is no paused live gate to resume.", "info");
						return;
					}
					appendReceipt(
						{
							...controller.snapshot(),
							boundary: before.boundary,
							pausedRegistrySnapshot: before.pausedRegistrySnapshot,
							waitingMs: before.waitingMs,
						},
						context,
					);
					context.ui.notify("Pause: resumed.", "info");
					return;
				}
				if (action === "cancel") {
					const before = controller.snapshot();
					const cancelled = controller.cancel();
					if (cancelled) appendReceipt(closedSnapshot(controller.snapshot(), before, "cancelled"), context);
					context.ui.notify(cancelled ? "Pause: cancelled." : "Pause: no active request.", "info");
					return;
				}
				context.ui.notify(USAGE, "warning");
			},
		});
	};
}

export { USAGE as PAUSE_USAGE };
