#!/usr/bin/env node

import { createConversationExtension } from "./conversation/conversation-extension.js";
import { createFastSessionController, prepareFastRuntimeArgs, selectFastRuntimeArgs } from "./fast.js";
import { createPrewalkExtension } from "./prewalk.js";
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
		if (loadWorkflow && isInteractive) {
			const parsedRuntimeWorkflow = parseWorkflowOption(runtimeArgs);
			const resolveResources = (workflowId) =>
				resolveWorkflowRuntimeResources(workflowId, parsedRuntimeWorkflow.forwardedArgs);
			const workflowExtension = createWorkflowSwitchExtension({
				initialResources: await resolveResources(parsedRuntimeWorkflow.workflowId),
				initialWorkflowId: parsedRuntimeWorkflow.workflowId,
				resolveResources,
			});
			const fastController = createFastSessionController({
				initiallyEnabled: fastRuntime.enabled,
				initialUseConfiguredModel: fastRuntime.useConfiguredModel,
				initialUseLowThinking: fastRuntime.useLowThinking,
			});
			const prewalkExtension = createPrewalkExtension({ fastController });
			const conversationExtension = createConversationExtension();
			const byzExtension = (pi) => {
				conversationExtension(pi);
				workflowExtension(pi);
				fastController.extension(pi);
				prewalkExtension(pi);
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
