import { parseArgs } from "./runtime/bundle/index.js";

const WORKFLOW_IDS = new Set(["cm", "cm-plugin", "none"]);
const NON_RUNTIME_COMMANDS = new Set(["auth", "config", "install", "list", "remove", "uninstall", "update"]);

export function getActiveByzOptionIndexes(args, optionName) {
	const indexes = new Set();
	const option = `--${optionName}`;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg !== option && !arg.startsWith(`${option}=`)) continue;

		let probeName = `__byz_${optionName}_probe_${index}`;
		while (args.some((candidate) => candidate === `--${probeName}` || candidate.startsWith(`--${probeName}=`))) {
			probeName += "_";
		}
		const equalsIndex = arg.indexOf("=");
		const probeArgs = [...args];
		probeArgs[index] = equalsIndex === -1 ? `--${probeName}` : `--${probeName}${arg.slice(equalsIndex)}`;
		if (parseArgs(probeArgs).unknownFlags.has(probeName)) indexes.add(index);
	}
	return indexes;
}

export function shouldLoadWorkflow(args) {
	const parsed = parseArgs(args);
	if (parsed.help || parsed.version || parsed.export || parsed.listModels !== undefined) return false;
	return !NON_RUNTIME_COMMANDS.has(args[0]);
}

export function shouldEnableWorkflowSwitch(args, { stdinIsTTY, stdoutIsTTY }) {
	if (!stdinIsTTY || !stdoutIsTTY) return false;
	const parsed = parseArgs(args);
	return !parsed.print && parsed.mode !== "json" && parsed.mode !== "rpc";
}

export function createWorkflowSwitchExtension({ initialResources, initialWorkflowId, resolveResources }) {
	let activeResources = initialResources;
	let activeWorkflowId = initialWorkflowId;

	return function workflowSwitchExtension(ports) {
		ports.on("resources_discover", () => ({
			promptPaths: activeResources.promptPaths,
			skillPaths: activeResources.skillPaths,
		}));

		ports.registerCommand("workflow", {
			description: "Show or switch the active BYZ workflow",
			handler: async (args, ctx) => {
				const targetWorkflowId = args.trim();
				if (!targetWorkflowId) {
					ctx.ui.notify(`BYZ workflow: ${activeWorkflowId}`, "info");
					return;
				}
				if (!WORKFLOW_IDS.has(targetWorkflowId)) {
					ctx.ui.notify("Usage: /workflow [cm|cm-plugin|none]", "error");
					return;
				}
				if (!ctx.isIdle()) {
					ctx.ui.notify("BYZ cannot switch workflows while the agent is running.", "warning");
					return;
				}
				if (targetWorkflowId === activeWorkflowId) {
					ctx.ui.notify(`BYZ workflow is already ${activeWorkflowId}.`, "info");
					return;
				}

				let nextResources;
				try {
					nextResources = await resolveResources(targetWorkflowId);
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
					return;
				}
				if (!ctx.isIdle()) {
					ctx.ui.notify("BYZ cannot switch workflows while the agent is running.", "warning");
					return;
				}

				ctx.ui.notify(`Switching BYZ workflow to ${targetWorkflowId}...`, "info");
				try {
					await ctx.replaceManagedResources(nextResources);
				} catch (error) {
					ctx.ui.notify(
						`BYZ workflow switch failed: ${error instanceof Error ? error.message : String(error)}`,
						"error",
					);
					return;
				}
				activeResources = nextResources;
				activeWorkflowId = targetWorkflowId;
			},
		});
	};
}
