import { createCommandRegistry, createHandledResult } from "./application/command-registry.js";
import { handleDiagnosticsCommand } from "./diagnostics/commands.js";
import { prepareFastRuntimeArgs } from "./fast.js";
import { handleByzUpdate } from "./update.js";
import { handleWorkflowCommand, parseWorkflowOption, resolveWorkflowRuntimeResources } from "./workflows.js";

function parsePrefix(prefix) {
	return (args) => (args[0] === prefix ? [...args] : undefined);
}

export function createByzCommandRegistry() {
	return createCommandRegistry([
		{
			id: "diagnostics",
			parse: parsePrefix("diagnostics"),
			execute: (input, context) => handleDiagnosticsCommand(input, context.diagnostics),
			runtime: "none",
		},
		{
			id: "workflow",
			parse: parsePrefix("workflow"),
			execute: (input, context) => handleWorkflowCommand(input, context.workflow),
			runtime: "none",
		},
		{
			id: "update",
			parse: parsePrefix("update"),
			execute: (input, context) => handleByzUpdate(input, context.update),
			runtime: "none",
		},
	]);
}

export function parseByzInvocation(args, env = process.env) {
	const fast = prepareFastRuntimeArgs(args, env);
	const workflow = parseWorkflowOption(fast.commandArgs);
	const presetCount = fast.args.length - fast.commandArgs.length;
	return Object.freeze({
		commandArgs: workflow.forwardedArgs,
		fast,
		passthroughArgs: [...fast.args.slice(0, presetCount), ...workflow.forwardedArgs],
		workflowId: workflow.workflowId,
	});
}

export function tryParseByzInvocation(args, env = process.env) {
	try {
		return { invocation: parseByzInvocation(args, env) };
	} catch (error) {
		return {
			result: createHandledResult({
				exitCode: 1,
				stderr: [error instanceof Error ? error.message : String(error)],
			}),
		};
	}
}

export function selectByzRuntimeArgs(invocation, options) {
	if (options.isInteractive) return invocation.commandArgs;
	return options.loadWorkflow ? invocation.passthroughArgs : invocation.commandArgs;
}

export async function prepareStaticWorkflowArgs(invocation, runtimeArgs) {
	const resources = await resolveWorkflowRuntimeResources(invocation.workflowId, runtimeArgs);
	return [
		...resources.skillPaths.flatMap((path) => ["--skill", path]),
		...resources.promptPaths.flatMap((path) => ["--prompt-template", path]),
		...runtimeArgs,
	];
}
