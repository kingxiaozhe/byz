#!/usr/bin/env node

import { createPiExtensionPorts, createPiRuntimeAdapter } from "./adapters/pi/pi-runtime-adapter.js";
import { applyCommandResult } from "./application/command-registry.js";
import {
	createByzCommandRegistry,
	prepareStaticWorkflowArgs,
	selectByzRuntimeArgs,
	tryParseByzInvocation,
} from "./bootstrap.js";
import { createConversationExtension } from "./conversation/conversation-extension.js";
import { createDiagnosticsExtension } from "./diagnostics/diagnostics-extension.js";
import { createDiagnosticsRecorder } from "./diagnostics/recorder.js";
import { bucketDuration, mapMode, mapRecoveryDegradeReason } from "./diagnostics/schema.js";
import { createExecutionExtension } from "./execution/execution-extension.js";
import { createExecutionRegistry } from "./execution/execution-registry.js";
import { createPauseController } from "./execution/pause-controller.js";
import { createPauseExtension } from "./execution/pause-extension.js";
import { createFastSessionController } from "./fast.js";
import { createPrewalkExtension } from "./prewalk.js";
import { createRecoveryExtension } from "./recovery/recovery-extension.js";
import { main, VERSION } from "./runtime/bundle/index.js";
import { createWorkflowSwitchExtension, shouldEnableWorkflowSwitch, shouldLoadWorkflow } from "./workflow-switch.js";
import { resolveWorkflowRuntimeResources } from "./workflows.js";

const commandRegistry = createByzCommandRegistry();
const piRuntime = createPiRuntimeAdapter(main, {
	showStartupHeader: false,
	showLoadedResources: false,
});

process.title = "byz";
process.env.PI_CODING_AGENT = "true";
process.env.AI_AGENT = "byz";
process.env.PI_SKIP_VERSION_CHECK = "1";
process.env.PI_TELEMETRY = "0";

const args = process.argv.slice(2);
const startedAt = performance.now();
let diagnostics;

function publishCommandResult(result) {
	applyCommandResult(result, {
		stderr: console.error,
		stdout: console.log,
		setExitCode: (exitCode) => {
			process.exitCode = exitCode;
		},
	});
}

try {
	const parsedInvocation = tryParseByzInvocation(args);
	if (!parsedInvocation.invocation) {
		publishCommandResult(parsedInvocation.result);
	} else {
		const invocation = parsedInvocation.invocation;
		const commandArgs = invocation.commandArgs;
		if (commandArgs[0] === "update") diagnostics = createDiagnosticsRecorder();
		const commandResult = await commandRegistry.execute(commandArgs, {
			diagnostics: { version: VERSION },
			update: { diagnostics },
			workflow: { workflowId: invocation.workflowId },
		});

		if (commandResult.status === "handled") {
			publishCommandResult(commandResult);
		} else {
			diagnostics ??= createDiagnosticsRecorder();
			const mode = mapMode(commandArgs);
			const diagnosticsFeature = createDiagnosticsExtension({ recorder: diagnostics, mode });
			const diagnosticsExtension = (pi) => {
				const ports = createPiExtensionPorts(pi);
				diagnosticsFeature(ports.diagnostics);
			};
			const loadWorkflow = shouldLoadWorkflow(commandArgs);
			const isInteractive = shouldEnableWorkflowSwitch(commandArgs, {
				stdinIsTTY: process.stdin.isTTY,
				stdoutIsTTY: process.stdout.isTTY,
			});
			const runtimeArgs = selectByzRuntimeArgs(invocation, { isInteractive, loadWorkflow });
			if (loadWorkflow && isInteractive) {
				const resolveResources = (workflowId) => resolveWorkflowRuntimeResources(workflowId, runtimeArgs);
				const workflowExtension = createWorkflowSwitchExtension({
					initialResources: await resolveResources(invocation.workflowId),
					initialWorkflowId: invocation.workflowId,
					resolveResources,
				});
				const fastController = createFastSessionController({
					initiallyEnabled: invocation.fast.enabled,
					initialUseConfiguredModel: invocation.fast.useConfiguredModel,
					initialUseLowThinking: invocation.fast.useLowThinking,
				});
				const prewalkExtension = createPrewalkExtension({ fastController });
				const recoveryExtension = createRecoveryExtension({
					onDegrade(reason) {
						diagnostics.record("byz.diagnostics.degrade", {
							component: "recovery",
							reason: mapRecoveryDegradeReason(reason),
							dropped_bucket: "1",
							error_site: "extension",
						});
					},
				});
				const byzExtension = (pi) => {
					const ports = createPiExtensionPorts(pi);
					const executionRegistry = createExecutionRegistry({
						appendReceipt: (receipt) => ports.execution.appendEntry(receipt),
					});
					const executionExtension = createExecutionExtension({ registry: executionRegistry });
					const pauseController = createPauseController({
						readRegistrySnapshot: () => executionRegistry.consumer.snapshot(),
					});
					const pauseExtension = createPauseExtension({ controller: pauseController });
					const conversationExtension = createConversationExtension({
						executionRegistry: executionRegistry.consumer,
						pauseController,
					});
					executionExtension(ports.execution);
					pauseExtension(ports.pause);
					conversationExtension(ports.conversation);
					recoveryExtension(ports.recovery);
					workflowExtension(ports.workflow);
					fastController.extension(ports.fast);
					prewalkExtension(ports.prewalk);
				};
				await piRuntime.run(runtimeArgs, {
					extensionFactories: [diagnosticsExtension],
					managedExtensionFactories: [{ factory: byzExtension, name: "workflow", resourcePrecedence: "before" }],
				});
			} else {
				const preparedArgs = loadWorkflow ? await prepareStaticWorkflowArgs(invocation, runtimeArgs) : runtimeArgs;
				await piRuntime.run(preparedArgs, {
					extensionFactories: [diagnosticsExtension],
					additionalResourcePrecedence: "before",
				});
			}
			diagnostics.record("byz.app.run", {
				version: VERSION,
				runtime: "node",
				mode,
				outcome: "ok",
				duration_bucket: bucketDuration(performance.now() - startedAt),
			});
		}
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
