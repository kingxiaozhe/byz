import { access, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";

const WORKFLOWS = [
	{
		id: "cm",
		name: "CM Workflow",
		packageName: "@aibyzero/cm-workflow",
		envRoot: "BYZ_CM_WORKFLOW_ROOT",
		requiredFiles: ["VERSION", "skills/cm-check/SKILL.md"],
	},
	{
		id: "cm-plugin",
		name: "CM Plugin Workflow",
		packageName: "@aibyzero/cm-plugin-workflow",
		envRoot: "BYZ_CM_PLUGIN_WORKFLOW_ROOT",
		requiredFiles: ["VERSION", "commands/cm-plugin:check.md"],
	},
];

function getWorkflow(id) {
	const workflow = WORKFLOWS.find((candidate) => candidate.id === id);
	if (!workflow) {
		throw new Error(`Unknown workflow: ${id ?? "<missing>"}. Expected cm or cm-plugin.`);
	}
	return workflow;
}

async function resolveConfiguredRoot(workflow) {
	const configured = process.env[workflow.envRoot];
	if (!configured) return undefined;
	return realpath(resolve(configured));
}

async function assertDistinctConfiguredRoots() {
	const roots = [];
	for (const workflow of WORKFLOWS) {
		const root = await resolveConfiguredRoot(workflow);
		if (root) roots.push({ id: workflow.id, root });
	}

	for (let index = 0; index < roots.length; index++) {
		for (let otherIndex = index + 1; otherIndex < roots.length; otherIndex++) {
			if (roots[index].root === roots[otherIndex].root) {
				throw new Error(
					`Workflow isolation violation: ${roots[index].id} and ${roots[otherIndex].id} use the same root.`,
				);
			}
		}
	}
}

async function getWorkflowStatus(workflow) {
	const root = await resolveConfiguredRoot(workflow);
	if (!root) {
		return {
			...workflow,
			available: false,
			source: "unavailable",
		};
	}

	let version;
	try {
		version = (await readFile(resolve(root, "VERSION"), "utf8")).trim();
	} catch {
		version = "unknown";
	}

	return {
		...workflow,
		available: true,
		root,
		source: "local",
		version,
	};
}

async function checkWorkflow(workflow) {
	await assertDistinctConfiguredRoots();
	const status = await getWorkflowStatus(workflow);
	if (!status.available) {
		throw new Error(`${workflow.name} is unavailable. Set ${workflow.envRoot} for bootstrap development.`);
	}

	const missingFiles = [];
	for (const relativePath of workflow.requiredFiles) {
		try {
			await access(resolve(status.root, relativePath));
		} catch {
			missingFiles.push(relativePath);
		}
	}
	if (missingFiles.length > 0) {
		throw new Error(`${workflow.name} is incomplete. Missing: ${missingFiles.join(", ")}`);
	}

	return status;
}

function printStatus(status) {
	console.log(`${status.id}: ${status.available ? "available" : "unavailable"}`);
	console.log(`  package: ${status.packageName}`);
	console.log(`  source: ${status.source}`);
	if (status.version) console.log(`  version: ${status.version}`);
	if (status.root) console.log(`  root: ${status.root}`);
}

export async function handleWorkflowCommand(args) {
	if (args[0] !== "workflow") return false;

	try {
		const command = args[1] ?? "list";
		if (command === "list") {
			await assertDistinctConfiguredRoots();
			for (const workflow of WORKFLOWS) {
				printStatus(await getWorkflowStatus(workflow));
			}
			return true;
		}

		if (command === "status") {
			await assertDistinctConfiguredRoots();
			printStatus(await getWorkflowStatus(getWorkflow(args[2])));
			return true;
		}

		if (command === "check") {
			const status = await checkWorkflow(getWorkflow(args[2]));
			console.log(`${status.id}: check passed`);
			console.log(`  version: ${status.version}`);
			console.log(`  root: ${status.root}`);
			return true;
		}

		throw new Error(`Unknown workflow command: ${command}. Expected list, status, or check.`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
		return true;
	}
}
