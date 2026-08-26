#!/usr/bin/env node

import { main } from "./runtime/bundle/index.js";
import { handleWorkflowCommand } from "./workflows.js";

process.title = "byz";
process.env.BYZ_CODING_AGENT = "true";
process.env.PI_CODING_AGENT = "true";
process.env.AI_AGENT = "byz";

const args = process.argv.slice(2);
const isRootHelp = args.length === 1 && (args[0] === "--help" || args[0] === "-h");

if (isRootHelp) {
	console.error("Bootstrap note: BYZ update is not available yet; Pi's update command is guarded.");
}

if (await handleWorkflowCommand(args)) {
	// BYZ-owned command handled without starting the Pi runtime.
} else if (args[0] === "update") {
	console.error("BYZ update is not available in the bootstrap build.");
	console.error("This guard prevents BYZ from using Pi's release channel.");
	process.exitCode = 2;
} else {
	await main(args);
}
