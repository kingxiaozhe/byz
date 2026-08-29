import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const PREWALK_COMMAND_USAGE = "Usage: /prewalk [cancel|status]";
const WRITE_TOOL_NAMES = new Set(["edit", "write"]);

function hasBuiltinWriteTools(pi) {
	const tools = new Map(pi.getAllTools().map((tool) => [tool.name, tool]));
	return [...WRITE_TOOL_NAMES].every((name) => {
		const sourceInfo = tools.get(name)?.sourceInfo;
		return sourceInfo?.source === "builtin" && sourceInfo.path === `<builtin:${name}>`;
	});
}

async function isWorkspacePath(cwd, inputPath) {
	if (typeof inputPath !== "string" || inputPath.length === 0) return false;
	try {
		const [workspaceRoot, targetPath] = await Promise.all([realpath(cwd), realpath(resolve(cwd, inputPath))]);
		const relativePath = relative(workspaceRoot, targetPath);
		return (
			relativePath.length > 0 &&
			relativePath !== ".." &&
			!relativePath.startsWith(`..${sep}`) &&
			!isAbsolute(relativePath)
		);
	} catch {
		return false;
	}
}

export function createPrewalkExtension({ fastController }) {
	if (!fastController) throw new Error("Prewalk requires the Fast session controller.");

	return function prewalkExtension(pi) {
		let state = "idle";
		let target;
		let candidateQueue = Promise.resolve();

		function reset() {
			state = "idle";
			target = undefined;
		}

		function notifyStatus(ctx) {
			if (state === "armed" && target) {
				ctx.ui.notify(
					`Prewalk: armed; target=${fastController.formatTarget(target)}; thinking=${target.thinking}`,
					"info",
				);
				return;
			}
			ctx.ui.notify(`Prewalk: ${state === "switching" ? "switching" : "not armed"}.`, "info");
		}

		function cancel(ctx, message = "Prewalk: canceled.") {
			if (state !== "armed") {
				ctx.ui.notify("Prewalk: not armed.", "info");
				return false;
			}
			reset();
			ctx.ui.notify(message, "info");
			return true;
		}

		function arm(ctx) {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Prewalk cannot arm while the agent is busy.", "warning");
				return;
			}
			if (!ctx.isProjectTrusted()) {
				ctx.ui.notify("Prewalk requires a trusted project.", "warning");
				return;
			}
			if (fastController.isActive()) {
				ctx.ui.notify("Prewalk cannot arm while Fast is already on.", "warning");
				return;
			}
			if (state === "armed") {
				ctx.ui.notify("Prewalk is already armed.", "info");
				return;
			}
			if (!hasBuiltinWriteTools(pi)) {
				ctx.ui.notify("Prewalk requires the built-in edit and write tools.", "warning");
				return;
			}
			const nextTarget = fastController.resolveTarget(ctx, { requireAuth: true, requireModel: true });
			if (!nextTarget) return;
			target = nextTarget;
			state = "armed";
			notifyStatus(ctx);
		}

		async function considerToolResult(event, ctx) {
			if (state !== "armed" || !target) return;
			if (event.isError || !WRITE_TOOL_NAMES.has(event.toolName)) return;
			if (!hasBuiltinWriteTools(pi)) return;
			if (!(await isWorkspacePath(ctx.cwd, event.input?.path))) return;
			if (state !== "armed" || !target) return;

			const consumedTarget = target;
			state = "switching";
			target = undefined;
			const applied = await fastController.applyTarget(ctx, consumedTarget);
			reset();
			if (applied) {
				ctx.ui.notify(
					`Prewalk: handed off to ${fastController.formatTarget(consumedTarget)}; thinking=${fastController.getThinkingLevel()}.`,
					"info",
				);
				return;
			}
			ctx.ui.notify("Prewalk: handoff failed and was canceled.", "error");
		}

		pi.registerCommand("prewalk", {
			description: "Arm a one-time handoff to the Fast target after the first successful write",
			handler: async (args, ctx) => {
				const action = args.trim().toLowerCase();
				if (!action) {
					arm(ctx);
					return;
				}
				if (action === "cancel") {
					cancel(ctx);
					return;
				}
				if (action === "status") {
					notifyStatus(ctx);
					return;
				}
				ctx.ui.notify(PREWALK_COMMAND_USAGE, "warning");
			},
		});

		pi.on("tool_result", (event, ctx) => {
			candidateQueue = candidateQueue.then(
				() => considerToolResult(event, ctx),
				() => considerToolResult(event, ctx),
			);
			return candidateQueue;
		});

		fastController.onExplicitSelection((_event, ctx) => {
			if (state === "armed") cancel(ctx, "Prewalk: canceled after an explicit model or thinking change.");
		});
		fastController.onActiveChange((active, ctx) => {
			if (active && state === "armed") cancel(ctx, "Prewalk: canceled because Fast was enabled.");
		});
	};
}
