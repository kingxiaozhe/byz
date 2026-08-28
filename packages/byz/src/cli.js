#!/usr/bin/env node

import { prepareFastRuntimeArgs } from "./fast.js";
import { main } from "./runtime/bundle/index.js";
import { handleByzUpdate } from "./update.js";
import { handleWorkflowCommand, parseWorkflowOption, prepareWorkflowRuntimeArgs } from "./workflows.js";

process.title = "byz";
process.env.BYZ_CODING_AGENT = "true";
process.env.PI_CODING_AGENT = "true";
process.env.AI_AGENT = "byz";
process.env.PI_SKIP_VERSION_CHECK = "1";
process.env.PI_TELEMETRY = "0";

const args = process.argv.slice(2);

function shouldLoadWorkflow(runtimeArgs) {
	const terminatorIndex = runtimeArgs.indexOf("--");
	const optionArgs = runtimeArgs.slice(0, terminatorIndex === -1 ? runtimeArgs.length : terminatorIndex);
	if (optionArgs.some((arg) => ["--help", "-h", "--version", "-v", "--export", "--list-models"].includes(arg))) {
		return false;
	}
	return !["auth", "config", "install", "list", "remove", "uninstall", "update"].includes(optionArgs[0]);
}

try {
	const fastRuntime = prepareFastRuntimeArgs(args);
	const parsedWorkflow = parseWorkflowOption(fastRuntime.commandArgs);
	const commandArgs = parsedWorkflow.forwardedArgs;
	const isRootHelp = commandArgs.length === 1 && (commandArgs[0] === "--help" || commandArgs[0] === "-h");
	if (isRootHelp) {
		console.error("BYZ updates: byz update (npm-managed global installations only)");
		console.error("BYZ Fast: --fast (thinking=low; optional model: BYZ_FAST_MODEL)");
		console.error("BYZ workflows: --workflow <cm|cm-plugin|none> (default: BYZ_WORKFLOW or cm)");
		console.error("Commands: byz workflow <list|status|check> [cm|cm-plugin]");
	}

	if (await handleWorkflowCommand(commandArgs)) {
		// BYZ-owned command handled without starting the Pi runtime.
	} else if (await handleByzUpdate(commandArgs)) {
		// BYZ release metadata and package target stay independent from Pi.
	} else {
		const loadWorkflow = shouldLoadWorkflow(commandArgs);
		const runtimeArgs = loadWorkflow ? fastRuntime.args : fastRuntime.commandArgs;
		const prepared = await prepareWorkflowRuntimeArgs(runtimeArgs, { load: loadWorkflow });
		const optionArgs = commandArgs.slice(
			0,
			commandArgs.indexOf("--") === -1 ? commandArgs.length : commandArgs.indexOf("--"),
		);
		const isInteractive = !optionArgs.some((arg) =>
			["--help", "-h", "--version", "-v", "--export", "--list-models", "--print", "-p", "--mode"].includes(arg),
		);
		if (fastRuntime.enabled && loadWorkflow && isInteractive) {
			console.error(
				`BYZ Fast: model=${fastRuntime.model}, thinking=${fastRuntime.thinking}, workflow=${prepared.workflowId}`,
			);
		}
		await main(prepared.args);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
