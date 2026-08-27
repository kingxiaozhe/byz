#!/usr/bin/env node

import { main } from "./runtime/bundle/index.js";
import { handleByzUpdate } from "./update.js";
import {
	getWorkflowInstallRequest,
	handleWorkflowCommand,
	installWorkflowPackage,
	parseWorkflowOption,
	prepareWorkflowRuntimeArgs,
} from "./workflows.js";

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
	const parsedWorkflow = parseWorkflowOption(args);
	const commandArgs = parsedWorkflow.forwardedArgs;
	const isRootHelp = commandArgs.length === 1 && (commandArgs[0] === "--help" || commandArgs[0] === "-h");
	if (isRootHelp) {
		console.error("BYZ updates: byz update (npm-managed global installations only)");
		console.error("BYZ workflows: --workflow <cm|cm-plugin|none> (default: BYZ_WORKFLOW or cm)");
		console.error("Commands: byz workflow <list|status|check|install> [cm|cm-plugin]");
	}

	const installRequest = await getWorkflowInstallRequest(commandArgs);
	if (installRequest) {
		await installWorkflowPackage(installRequest);
	} else if (await handleWorkflowCommand(commandArgs)) {
		// BYZ-owned command handled without starting the Pi runtime.
	} else if (await handleByzUpdate(commandArgs)) {
		// BYZ release metadata and package target stay independent from Pi.
	} else {
		const prepared = await prepareWorkflowRuntimeArgs(args, { load: shouldLoadWorkflow(commandArgs) });
		await main(prepared.args);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
