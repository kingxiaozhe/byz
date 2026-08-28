import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSkillsFromDir } from "./runtime/bundle/index.js";
import { getActiveByzOptionIndexes } from "./workflow-switch.js";

const lockPath = fileURLToPath(new URL("../workflows.lock.json", import.meta.url));
const packageDir = dirname(lockPath);
let workflowsPromise;

async function loadWorkflows() {
	workflowsPromise ??= readFile(lockPath, "utf8").then((content) => {
		const lock = JSON.parse(content);
		if (lock.schemaVersion !== 1 || !lock.workflows) {
			throw new Error("Unsupported BYZ workflow lock format.");
		}
		return Object.entries(lock.workflows).map(([id, workflow]) => ({ id, ...workflow }));
	});
	return workflowsPromise;
}

async function getWorkflow(id) {
	const workflow = (await loadWorkflows()).find((candidate) => candidate.id === id);
	if (!workflow) {
		throw new Error(`Unknown workflow: ${id ?? "<missing>"}. Expected cm, cm-plugin, or none.`);
	}
	return workflow;
}

async function resolveConfiguredRoot(workflow) {
	const configured = process.env[workflow.envRoot];
	if (!configured) return undefined;
	return { root: await realpath(resolve(configured)), source: "local" };
}

async function resolveBundledRoot(workflow) {
	if (!workflow.bundled || !workflow.bundledPath) return undefined;
	try {
		return { root: await realpath(resolve(packageDir, workflow.bundledPath)), source: "bundled" };
	} catch {
		return undefined;
	}
}

async function resolveWorkflowRoot(workflow) {
	return (await resolveConfiguredRoot(workflow)) ?? (await resolveBundledRoot(workflow));
}

async function assertDistinctRoots() {
	const roots = [];
	for (const workflow of await loadWorkflows()) {
		const resolved = await resolveWorkflowRoot(workflow);
		if (resolved) roots.push({ id: workflow.id, root: resolved.root });
	}

	for (let index = 0; index < roots.length; index++) {
		for (let otherIndex = index + 1; otherIndex < roots.length; otherIndex++) {
			const leftToRight = relative(roots[index].root, roots[otherIndex].root);
			const rightToLeft = relative(roots[otherIndex].root, roots[index].root);
			const contains = (candidate) =>
				candidate === "" || (!candidate.startsWith(`..${sep}`) && candidate !== ".." && !isAbsolute(candidate));
			if (contains(leftToRight) || contains(rightToLeft)) {
				throw new Error(
					`Workflow isolation violation: ${roots[index].id} and ${roots[otherIndex].id} roots overlap.`,
				);
			}
		}
	}
}

async function readWorkflowVersion(root) {
	try {
		const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
		if (packageJson.version) return packageJson.version;
	} catch {
		// Local development roots may not have package metadata yet.
	}
	try {
		return (await readFile(resolve(root, "VERSION"), "utf8")).trim();
	} catch {
		return "unknown";
	}
}

async function getWorkflowStatus(workflow) {
	const resolved = await resolveWorkflowRoot(workflow);
	if (!resolved) {
		return { ...workflow, available: false, source: "unavailable" };
	}
	return {
		...workflow,
		available: true,
		...resolved,
		resolvedVersion: await readWorkflowVersion(resolved.root),
	};
}

async function validateRequiredFile(root, relativePath, missingFiles) {
	try {
		if (!(await stat(resolve(root, relativePath))).isFile()) missingFiles.push(relativePath);
	} catch {
		missingFiles.push(relativePath);
	}
}

async function validateWorkflowResources(status) {
	const invalidSkills = [];
	for (const skillPath of status.skillsPaths) {
		const result = loadSkillsFromDir({ dir: resolve(status.root, skillPath), source: `byz:${status.id}` });
		if (result.skills.length === 0) invalidSkills.push(skillPath);
	}

	let hasPrompt = false;
	try {
		const entries = await readdir(resolve(status.root, status.promptsPath), { withFileTypes: true });
		hasPrompt = entries.some((entry) => entry.isFile() && entry.name.endsWith(".md"));
	} catch {
		// Report the prompt path below.
	}

	if (invalidSkills.length > 0 || !hasPrompt) {
		const issues = [];
		if (invalidSkills.length > 0) issues.push(`skills with no valid SKILL.md: ${invalidSkills.join(", ")}`);
		if (!hasPrompt) issues.push(`prompt directory with no top-level Markdown: ${status.promptsPath}`);
		throw new Error(`${status.name} has no Pi-loadable resources. ${issues.join("; ")}`);
	}
}

async function validatePackageManifest(status) {
	if (status.source === "local") return;
	const packageJson = JSON.parse(await readFile(resolve(status.root, "package.json"), "utf8"));
	if (packageJson.name !== status.packageName) {
		throw new Error(`${status.name} package mismatch: expected ${status.packageName}, found ${packageJson.name}.`);
	}
	const normalize = (entries = []) => entries.map((entry) => entry.replace(/^\.\//, "")).sort();
	if (
		JSON.stringify(normalize(packageJson.pi?.skills)) !== JSON.stringify(normalize(status.skillsPaths)) ||
		JSON.stringify(normalize(packageJson.pi?.prompts)) !== JSON.stringify(normalize([status.promptsPath]))
	) {
		throw new Error(`${status.name} Pi manifest does not match the BYZ workflow lock.`);
	}
}

async function checkWorkflow(workflow) {
	await assertDistinctRoots();
	const status = await getWorkflowStatus(workflow);
	if (!status.available) {
		throw new Error(`${workflow.name} is unavailable. Reinstall BYZ or set its local development override.`);
	}

	const missingFiles = [];
	for (const relativePath of workflow.requiredFiles) {
		await validateRequiredFile(status.root, relativePath, missingFiles);
	}
	if (missingFiles.length > 0) {
		throw new Error(`${workflow.name} is incomplete. Missing: ${missingFiles.join(", ")}`);
	}
	if (status.source !== "local" && status.resolvedVersion !== workflow.version) {
		throw new Error(
			`${workflow.name} version mismatch: expected ${workflow.version}, found ${status.resolvedVersion}.`,
		);
	}
	await validateWorkflowResources(status);
	await validatePackageManifest(status);
	return status;
}

function printStatus(status) {
	console.log(`${status.id}: ${status.available ? "available" : "unavailable"}`);
	console.log(`  package: ${status.packageName}`);
	console.log(`  source: ${status.source}`);
	console.log(`  expected: ${status.version}`);
	if (status.resolvedVersion) console.log(`  version: ${status.resolvedVersion}`);
	if (status.root) console.log(`  root: ${status.root}`);
}

export function parseWorkflowOption(args) {
	const forwardedArgs = [];
	const activeWorkflowOptions = getActiveByzOptionIndexes(args, "workflow");
	let selected;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--") {
			forwardedArgs.push(...args.slice(index));
			break;
		}
		if (arg === "--workflow" && activeWorkflowOptions.has(index)) {
			if (selected !== undefined) throw new Error("--workflow may only be specified once.");
			const value = args[++index];
			if (!value || value.startsWith("-")) throw new Error("--workflow requires cm, cm-plugin, or none.");
			selected = value;
			continue;
		}
		if (arg.startsWith("--workflow=") && activeWorkflowOptions.has(index)) {
			if (selected !== undefined) throw new Error("--workflow may only be specified once.");
			selected = arg.slice("--workflow=".length);
			continue;
		}
		forwardedArgs.push(arg);
	}
	const workflowId = selected ?? process.env.BYZ_WORKFLOW ?? "cm";
	if (!["cm", "cm-plugin", "none"].includes(workflowId)) {
		throw new Error(`Unknown workflow: ${workflowId}. Expected cm, cm-plugin, or none.`);
	}
	return { forwardedArgs, workflowId };
}

export async function resolveWorkflowRuntimeResources(workflowId, args = []) {
	if (workflowId === "none") {
		return { promptPaths: [], skillPaths: [] };
	}

	const status = await checkWorkflow(await getWorkflow(workflowId));
	const terminatorIndex = args.indexOf("--");
	const optionArgs = args.slice(0, terminatorIndex === -1 ? args.length : terminatorIndex);
	const noSkills = optionArgs.some((arg) => arg === "--no-skills" || arg === "-ns");
	const noPrompts = optionArgs.some((arg) => arg === "--no-prompt-templates" || arg === "-np");
	return {
		promptPaths: noPrompts ? [] : [resolve(status.root, status.promptsPath)],
		skillPaths: noSkills ? [] : status.skillsPaths.map((skillPath) => resolve(status.root, skillPath)),
	};
}

export async function prepareWorkflowRuntimeArgs(args, options = {}) {
	const { forwardedArgs, workflowId } = parseWorkflowOption(args);
	if (options.load === false) {
		return { args: forwardedArgs, workflowId };
	}

	const resources = await resolveWorkflowRuntimeResources(workflowId, forwardedArgs);
	const workflowArgs = resources.skillPaths.flatMap((skillPath) => ["--skill", skillPath]);
	workflowArgs.push(...resources.promptPaths.flatMap((promptPath) => ["--prompt-template", promptPath]));
	return {
		workflowId,
		args: [...workflowArgs, ...forwardedArgs],
	};
}

export async function handleWorkflowCommand(args) {
	if (args[0] !== "workflow") return false;

	try {
		const command = args[1] ?? "list";
		if (command === "list") {
			await assertDistinctRoots();
			for (const workflow of await loadWorkflows()) {
				printStatus(await getWorkflowStatus(workflow));
			}
			return true;
		}

		if (command === "status") {
			await assertDistinctRoots();
			printStatus(await getWorkflowStatus(await getWorkflow(args[2])));
			return true;
		}

		if (command === "check") {
			const status = await checkWorkflow(await getWorkflow(args[2]));
			console.log(`${status.id}: check passed`);
			console.log(`  source: ${status.source}`);
			console.log(`  version: ${status.resolvedVersion}`);
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
