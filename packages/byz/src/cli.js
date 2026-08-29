#!/usr/bin/env node

import { createFastSwitchExtension, prepareFastRuntimeArgs, selectFastRuntimeArgs } from "./fast.js";
import { main } from "./runtime/bundle/index.js";
import { handleByzUpdate } from "./update.js";
import { createWorkflowSwitchExtension, shouldEnableWorkflowSwitch, shouldLoadWorkflow } from "./workflow-switch.js";
import {
	handleWorkflowCommand,
	parseWorkflowOption,
	prepareWorkflowRuntimeArgs,
	resolveWorkflowRuntimeResources,
} from "./workflows.js";

process.title = "byz";
process.env.BYZ_CODING_AGENT = "true";
process.env.PI_CODING_AGENT = "true";
process.env.AI_AGENT = "byz";
process.env.PI_SKIP_VERSION_CHECK = "1";
process.env.PI_TELEMETRY = "0";

const args = process.argv.slice(2);

try {
	const fastRuntime = prepareFastRuntimeArgs(args);
	const parsedWorkflow = parseWorkflowOption(fastRuntime.commandArgs);
	const commandArgs = parsedWorkflow.forwardedArgs;
	const isRootHelp = commandArgs.length === 1 && (commandArgs[0] === "--help" || commandArgs[0] === "-h");
	if (isRootHelp) {
		console.error("BYZ updates: byz update (npm-managed global installations only)");
		console.error("BYZ Fast: --fast (thinking=low; optional model: BYZ_FAST_MODEL)");
		console.error("BYZ workflows: --workflow <cm|cm-plugin|none> (default: BYZ_WORKFLOW or cm)");
		console.error(
			"Commands: byz workflow list | byz workflow status [cm|cm-plugin|none] | byz workflow check <cm|cm-plugin>",
		);
	}

	if (await handleWorkflowCommand(commandArgs, { workflowId: parsedWorkflow.workflowId })) {
		// BYZ-owned command handled without starting the Pi runtime.
	} else if (await handleByzUpdate(commandArgs)) {
		// BYZ release metadata and package target stay independent from Pi.
	} else {
		const loadWorkflow = shouldLoadWorkflow(commandArgs);
		const isInteractive = shouldEnableWorkflowSwitch(commandArgs, {
			stdinIsTTY: process.stdin.isTTY,
			stdoutIsTTY: process.stdout.isTTY,
		});
		const runtimeArgs = selectFastRuntimeArgs(fastRuntime, { isInteractive, loadWorkflow });
		if (fastRuntime.enabled && loadWorkflow && isInteractive) {
			console.error(
				`BYZ Fast: model=${fastRuntime.model}, thinking=${fastRuntime.thinking}, workflow=${parsedWorkflow.workflowId}`,
			);
		}

		if (loadWorkflow && isInteractive) {
			const parsedRuntimeWorkflow = parseWorkflowOption(runtimeArgs);
			const resolveResources = (workflowId) =>
				resolveWorkflowRuntimeResources(workflowId, parsedRuntimeWorkflow.forwardedArgs);
			const workflowExtension = createWorkflowSwitchExtension({
				initialResources: await resolveResources(parsedRuntimeWorkflow.workflowId),
				initialWorkflowId: parsedRuntimeWorkflow.workflowId,
				resolveResources,
			});
			const fastExtension = createFastSwitchExtension({
				initiallyEnabled: fastRuntime.enabled,
				initialUseConfiguredModel: fastRuntime.useConfiguredModel,
				initialUseLowThinking: fastRuntime.useLowThinking,
			});
			const byzExtension = (pi) => {
				workflowExtension(pi);
				fastExtension(pi);
			};
			await main(parsedRuntimeWorkflow.forwardedArgs, { byzWorkflowExtensionFactory: byzExtension });
		} else {
			const prepared = await prepareWorkflowRuntimeArgs(runtimeArgs, { load: loadWorkflow });
			await main(prepared.args);
		}
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
