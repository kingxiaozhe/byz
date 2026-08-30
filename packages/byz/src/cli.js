#!/usr/bin/env node

import { createConversationExtension } from "./conversation/conversation-extension.js";
import { handleDiagnosticsCommand } from "./diagnostics/commands.js";
import { createDiagnosticsExtension } from "./diagnostics/diagnostics-extension.js";
import { createDiagnosticsRecorder } from "./diagnostics/recorder.js";
import { bucketDuration, mapMode } from "./diagnostics/schema.js";
import { createFastSessionController, prepareFastRuntimeArgs, selectFastRuntimeArgs } from "./fast.js";
import { createPrewalkExtension } from "./prewalk.js";
import { main, VERSION } from "./runtime/bundle/index.js";
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
const startedAt = performance.now();
let diagnostics;

try {
	const fastRuntime = prepareFastRuntimeArgs(args);
	const parsedWorkflow = parseWorkflowOption(fastRuntime.commandArgs);
	const commandArgs = parsedWorkflow.forwardedArgs;
	if (commandArgs[0] === "update") diagnostics = createDiagnosticsRecorder();

	if (await handleDiagnosticsCommand(commandArgs, { version: VERSION })) {
		// Diagnostics commands are explicit local operations and do not start the Pi runtime.
	} else if (await handleWorkflowCommand(commandArgs, { workflowId: parsedWorkflow.workflowId })) {
		// BYZ-owned command handled without starting the Pi runtime.
	} else if (await handleByzUpdate(commandArgs, { diagnostics })) {
		// BYZ release metadata and package target stay independent from Pi.
	} else {
		diagnostics ??= createDiagnosticsRecorder();
		const mode = mapMode(commandArgs);
		const diagnosticsExtension = createDiagnosticsExtension({ recorder: diagnostics, mode });
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
			await main(parsedRuntimeWorkflow.forwardedArgs, {
				extensionFactories: [diagnosticsExtension],
				byzWorkflowExtensionFactory: byzExtension,
			});
		} else {
			const prepared = await prepareWorkflowRuntimeArgs(runtimeArgs, { load: loadWorkflow });
			await main(prepared.args, { extensionFactories: [diagnosticsExtension] });
		}
		diagnostics.record("byz.app.run", {
			version: VERSION,
			runtime: "node",
			mode,
			outcome: "ok",
			duration_bucket: bucketDuration(performance.now() - startedAt),
		});
	}
} catch (error) {
	diagnostics?.record("byz.diagnostics.degrade", {
		component: "recorder",
		reason: "unknown",
		dropped_bucket: "unknown",
		error_site: "cli",
	});
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
