import { execFileSync } from "node:child_process";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DefaultPackageManager,
	getAgentDir,
	loadSkillsFromDir,
	parseGitUrl,
	SettingsManager,
} from "./runtime/bundle/index.js";

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

async function resolveManagedRoot(workflow) {
	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(cwd, agentDir);
	const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });

	for (const configured of packageManager.listConfiguredPackages()) {
		if (!configured.installedPath) continue;
		try {
			const packageJson = JSON.parse(await readFile(resolve(configured.installedPath, "package.json"), "utf8"));
			if (packageJson.name === workflow.packageName) {
				const settings =
					configured.scope === "user" ? settingsManager.getGlobalSettings() : settingsManager.getProjectSettings();
				const packageConfig = (settings.packages ?? []).find(
					(candidate) => (typeof candidate === "string" ? candidate : candidate.source) === configured.source,
				);
				const autoloadDisabled =
					typeof packageConfig === "object" &&
					packageConfig.autoload === false &&
					["extensions", "skills", "prompts", "themes"].every(
						(resourceType) => !packageConfig[resourceType] || packageConfig[resourceType].length === 0,
					);
				return {
					root: await realpath(configured.installedPath),
					source: "managed",
					configuredSource: configured.source,
					autoloadDisabled,
				};
			}
		} catch {
			// Ignore unrelated or incomplete configured packages.
		}
	}
	return undefined;
}

async function resolveWorkflowRoot(workflow) {
	return (
		(await resolveConfiguredRoot(workflow)) ??
		(await resolveBundledRoot(workflow)) ??
		(await resolveManagedRoot(workflow))
	);
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

function extractPinnedGitCommit(source) {
	const parsed = source ? parseGitUrl(source) : null;
	return parsed?.ref && /^[0-9a-f]{40}$/i.test(parsed.ref) ? parsed.ref.toLowerCase() : undefined;
}

function readGitHead(root) {
	try {
		return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		})
			.trim()
			.toLowerCase();
	} catch {
		return undefined;
	}
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
		const installHint = workflow.private
			? ` Run "byz workflow install ${workflow.id}" with repository access.`
			: " Reinstall BYZ or set its local development override.";
		throw new Error(`${workflow.name} is unavailable.${installHint}`);
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
	if (status.source === "managed") {
		if (!status.autoloadDisabled) {
			throw new Error(`${workflow.name} must be installed with Pi package autoload disabled.`);
		}
		const pinnedCommit = extractPinnedGitCommit(status.configuredSource);
		if (!pinnedCommit) {
			throw new Error(`${workflow.name} managed source must be pinned to a full Git commit SHA.`);
		}
		const installedCommit = readGitHead(status.root);
		if (installedCommit !== pinnedCommit) {
			throw new Error(
				`${workflow.name} source mismatch: configured ${pinnedCommit}, installed ${installedCommit ?? "unknown"}.`,
			);
		}
	}
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

export async function getWorkflowInstallRequest(args) {
	if (args[0] !== "workflow" || args[1] !== "install") return undefined;
	const workflow = await getWorkflow(args[2]);
	if (workflow.bundled) {
		throw new Error(`${workflow.name} is bundled with BYZ and does not need installation.`);
	}
	const source = process.env[workflow.sourceEnv];
	if (!source) {
		throw new Error(
			`${workflow.sourceEnv} must contain the authorized private Git source pinned to a full commit SHA.`,
		);
	}
	if (!extractPinnedGitCommit(source)) {
		throw new Error(`${workflow.sourceEnv} must be a Git source pinned to a full 40-character commit SHA.`);
	}
	return { id: workflow.id, source };
}

export async function installWorkflowPackage(request) {
	const workflow = await getWorkflow(request.id);
	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(cwd, agentDir);
	const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
	await packageManager.installAndPersist(request.source);

	const packages = settingsManager.getGlobalSettings().packages ?? [];
	let updated = false;
	const disabledPackages = packages.map((configured) => {
		const source = typeof configured === "string" ? configured : configured.source;
		if (source !== request.source) return configured;
		updated = true;
		return { source, autoload: false };
	});
	if (!updated) throw new Error(`Installed ${workflow.name}, but its BYZ package setting was not found.`);
	settingsManager.setPackages(disabledPackages);
	await settingsManager.flush();
	console.log(`Installed ${workflow.name} with package autoload disabled.`);
}

export function parseWorkflowOption(args) {
	const forwardedArgs = [];
	let selected;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--") {
			forwardedArgs.push(...args.slice(index));
			break;
		}
		if (arg === "--workflow") {
			if (selected !== undefined) throw new Error("--workflow may only be specified once.");
			const value = args[++index];
			if (!value || value.startsWith("-")) throw new Error("--workflow requires cm, cm-plugin, or none.");
			selected = value;
			continue;
		}
		if (arg.startsWith("--workflow=")) {
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

export async function prepareWorkflowRuntimeArgs(args, options = {}) {
	const { forwardedArgs, workflowId } = parseWorkflowOption(args);
	if (options.load === false || workflowId === "none") {
		return { args: forwardedArgs, workflowId };
	}

	const status = await checkWorkflow(await getWorkflow(workflowId));
	const terminatorIndex = forwardedArgs.indexOf("--");
	const optionArgs = forwardedArgs.slice(0, terminatorIndex === -1 ? forwardedArgs.length : terminatorIndex);
	const noSkills = optionArgs.some((arg) => arg === "--no-skills" || arg === "-ns");
	const noPrompts = optionArgs.some((arg) => arg === "--no-prompt-templates" || arg === "-np");
	const workflowArgs = [];
	if (!noSkills) {
		workflowArgs.push(...status.skillsPaths.flatMap((skillPath) => ["--skill", resolve(status.root, skillPath)]));
	}
	if (!noPrompts) {
		workflowArgs.push("--prompt-template", resolve(status.root, status.promptsPath));
	}
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

		if (command === "install") {
			throw new Error("Workflow installation could not be delegated to the BYZ package manager.");
		}

		throw new Error(`Unknown workflow command: ${command}. Expected list, status, check, or install.`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
		return true;
	}
}
