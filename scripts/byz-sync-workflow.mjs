#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { valid } from "semver";

const currentFile = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = dirname(dirname(currentFile));
const WORKFLOW_CONTRACTS = {
	cm: { bundled: true, name: "CM Workflow", packageName: "@aibyzero/cm-workflow" },
	"cm-plugin": {
		bundled: true,
		name: "CM Plugin Workflow",
		packageName: "@aibyzero/cm-plugin-workflow",
	},
};

export class WorkflowSyncError extends Error {}

function run(executable, args, options = {}) {
	const output = execFileSync(executable, args, {
		cwd: options.cwd,
		encoding: "utf8",
		env: options.env ?? process.env,
		stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
	});
	return typeof output === "string" ? output.trim() : "";
}

function git(cwd, args, runner = run) {
	return runner("git", args, { cwd });
}

function json(value) {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

function normalizeResourcePath(value, label) {
	if (typeof value !== "string") throw new WorkflowSyncError(`${label} must contain only string paths.`);
	const normalized = value.replace(/^\.\//, "").replaceAll("\\", "/");
	if (!normalized || isAbsolute(normalized) || normalized.split("/").includes("..")) {
		throw new WorkflowSyncError(`${label} contains an unsafe path: ${value}`);
	}
	return normalized;
}

function normalizeResourcePaths(values, label) {
	if (!Array.isArray(values) || values.length === 0) {
		throw new WorkflowSyncError(`${label} must contain at least one path.`);
	}
	return [...new Set(values.map((value) => normalizeResourcePath(value, label)))];
}

function parseArguments(args) {
	let apply = false;
	let help = false;
	let root;
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === "--apply") {
			apply = true;
		} else if (argument === "--root") {
			root = args[++index];
			if (!root || root.startsWith("--")) throw new WorkflowSyncError("--root requires a workflow checkout path.");
		} else if (argument === "--help" || argument === "-h") {
			help = true;
		} else {
			throw new WorkflowSyncError(`Unknown workflow sync argument: ${argument}`);
		}
	}
	if (!help && !root) throw new WorkflowSyncError("--root is required.");
	return { apply, help, root };
}

async function resolveCheckoutResource(root, path, label) {
	let target;
	try {
		target = await realpath(resolve(root, path));
	} catch {
		throw new WorkflowSyncError(`${label} does not exist: ${path}.`);
	}
	const relation = relative(root, target);
	if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
		throw new WorkflowSyncError(`${label} resolves outside the workflow checkout: ${path}.`);
	}
	return target;
}

async function assertResourceDirectory(root, path, label) {
	const target = await resolveCheckoutResource(root, path, label);
	if (!(await stat(target)).isDirectory()) {
		throw new WorkflowSyncError(`${label} must be a directory: ${path}.`);
	}
}

async function readJson(path, label) {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		throw new WorkflowSyncError(`Could not read ${label}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function inspectWorkflowCheckout(workflowId, root, runner = run) {
	const contract = WORKFLOW_CONTRACTS[workflowId];
	if (!contract) throw new WorkflowSyncError(`Unknown workflow: ${workflowId}.`);
	const workflowRoot = await realpath(resolve(root));
	const gitRoot = await realpath(git(workflowRoot, ["rev-parse", "--show-toplevel"], runner));
	if (gitRoot !== workflowRoot) throw new WorkflowSyncError("--root must be the workflow Git repository root.");
	if (git(workflowRoot, ["status", "--porcelain", "--untracked-files=all"], runner)) {
		throw new WorkflowSyncError(`${contract.name} checkout must be clean.`);
	}
	const branch = git(workflowRoot, ["branch", "--show-current"], runner);
	if (!branch) throw new WorkflowSyncError(`${contract.name} checkout must be on a branch, not detached HEAD.`);
	const commit = git(workflowRoot, ["rev-parse", "HEAD"], runner).toLowerCase();
	if (!/^[0-9a-f]{40}$/.test(commit)) throw new WorkflowSyncError(`${contract.name} HEAD is not a full Git commit.`);

	const packageJson = await readJson(resolve(workflowRoot, "package.json"), `${contract.name} package.json`);
	if (packageJson.name !== contract.packageName) {
		throw new WorkflowSyncError(`${contract.name} package identity must be ${contract.packageName}.`);
	}
	if (valid(packageJson.version) !== packageJson.version) {
		throw new WorkflowSyncError(`${contract.name} package version must be valid semantic versioning.`);
	}
	const version = (await readFile(resolve(workflowRoot, "VERSION"), "utf8")).trim();
	if (version !== packageJson.version) {
		throw new WorkflowSyncError(`${contract.name} VERSION must match package.json version ${packageJson.version}.`);
	}
	const skillsPaths = normalizeResourcePaths(packageJson.pi?.skills, `${contract.name} pi.skills`);
	const prompts = normalizeResourcePaths(packageJson.pi?.prompts, `${contract.name} pi.prompts`);
	if (prompts.length !== 1) throw new WorkflowSyncError(`${contract.name} must declare exactly one Pi prompt path.`);
	await Promise.all([
		...skillsPaths.map((path) => assertResourceDirectory(workflowRoot, path, `${contract.name} pi.skills`)),
		assertResourceDirectory(workflowRoot, prompts[0], `${contract.name} pi.prompts`),
	]);
	return { commit, packageJson, promptsPath: prompts[0], root: workflowRoot, skillsPaths, version };
}

function sourceAtCommit(source, commit) {
	if (typeof source !== "string" || !source.includes("#")) {
		throw new WorkflowSyncError("Bundled workflow source must be a Git package pinned with #<commit>.");
	}
	return `${source.slice(0, source.lastIndexOf("#"))}#${commit}`;
}

export function createWorkflowSyncPlan({ byzPackageJson, checkout, workflowId, workflowLock }) {
	const contract = WORKFLOW_CONTRACTS[workflowId];
	if (!contract) throw new WorkflowSyncError(`Unknown workflow: ${workflowId}.`);
	if (workflowLock?.schemaVersion !== 1 || !workflowLock.workflows?.[workflowId]) {
		throw new WorkflowSyncError(`BYZ workflow lock is missing ${workflowId}.`);
	}
	const current = workflowLock.workflows[workflowId];
	const nextRecord = {
		...current,
		version: checkout.version,
		skillsPaths: checkout.skillsPaths,
		promptsPath: checkout.promptsPath,
	};
	const nextByzPackageJson = structuredClone(byzPackageJson);
	if (typeof checkout.packageJson.license !== "string" || !checkout.packageJson.license) {
		throw new WorkflowSyncError(`${contract.name} package must declare a license.`);
	}
	const source = sourceAtCommit(current.source, checkout.commit);
	nextRecord.source = source;
	nextRecord.license = checkout.packageJson.license;
	if (nextByzPackageJson.devDependencies?.[contract.packageName] === undefined) {
		throw new WorkflowSyncError(`BYZ package is missing ${contract.packageName} devDependency.`);
	}
	nextByzPackageJson.devDependencies[contract.packageName] = source;
	const nextWorkflowLock = structuredClone(workflowLock);
	nextWorkflowLock.workflows[workflowId] = nextRecord;
	return {
		commit: checkout.commit,
		currentVersion: current.version,
		nextByzPackageJson,
		nextVersion: checkout.version,
		nextWorkflowLock,
		refreshLockfile: true,
		workflowId,
		workflowName: contract.name,
	};
}

async function assertRequiredFiles(checkout, record) {
	for (const path of record.requiredFiles ?? []) {
		const normalized = normalizeResourcePath(path, `${checkout.packageJson.name} requiredFiles`);
		const target = await resolveCheckoutResource(
			checkout.root,
			normalized,
			`${checkout.packageJson.name} required file`,
		);
		if (!(await stat(target)).isFile()) {
			throw new WorkflowSyncError(`${checkout.packageJson.name} required file must be a file: ${normalized}.`);
		}
	}
}

async function assertApplyRepositoryState(repositoryRoot, runner = run) {
	if (git(repositoryRoot, ["status", "--porcelain", "--untracked-files=all"], runner)) {
		throw new WorkflowSyncError("BYZ worktree must be clean before applying a workflow synchronization.");
	}
	const branch = git(repositoryRoot, ["branch", "--show-current"], runner);
	if (!branch || branch === "main" || branch === "master") {
		throw new WorkflowSyncError("Apply workflow synchronization from a BYZ feature branch.");
	}
}

async function applyPlan(plan, paths, options = {}) {
	const refreshLockfile = options.refreshLockfile ?? (() => {
		run("npm", ["install", "--package-lock-only", "--ignore-scripts"], {
			cwd: paths.repositoryRoot,
			env: { ...process.env, PI_ALLOW_LOCKFILE_CHANGE: "1" },
			inherit: true,
		});
	});
	const originals = {
		byzPackage: await readFile(paths.byzPackagePath, "utf8"),
		lockfile: await readFile(paths.lockfilePath, "utf8"),
		workflowLock: await readFile(paths.workflowLockPath, "utf8"),
	};
	try {
		await writeFile(paths.byzPackagePath, json(plan.nextByzPackageJson));
		await writeFile(paths.workflowLockPath, json(plan.nextWorkflowLock));
		if (plan.refreshLockfile) await refreshLockfile();
	} catch (error) {
		await Promise.all([
			writeFile(paths.byzPackagePath, originals.byzPackage),
			writeFile(paths.lockfilePath, originals.lockfile),
			writeFile(paths.workflowLockPath, originals.workflowLock),
		]);
		throw error;
	}
}

export async function runWorkflowSync(options) {
	const workflowId = options.workflowId;
	const contract = WORKFLOW_CONTRACTS[workflowId];
	if (!contract) throw new WorkflowSyncError(`Unknown workflow: ${workflowId}. Expected cm or cm-plugin.`);
	const parsed = parseArguments(options.argv ?? []);
	const write = options.write ?? console.log;
	if (parsed.help) {
		write(`Usage: npm run byz:sync-${workflowId} -- --root <clean-workflow-checkout> [--apply]`);
		write("Without --apply, the command only reports the BYZ metadata synchronization plan.");
		return { status: "help" };
	}

	const repositoryRoot = await realpath(resolve(options.repositoryRoot ?? defaultRepositoryRoot));
	const paths = {
		byzPackagePath: resolve(repositoryRoot, "packages/byz/package.json"),
		lockfilePath: resolve(repositoryRoot, "package-lock.json"),
		repositoryRoot,
		workflowLockPath: resolve(repositoryRoot, "packages/byz/workflows.lock.json"),
	};
	const [byzPackageJson, workflowLock, checkout] = await Promise.all([
		readJson(paths.byzPackagePath, "BYZ package.json"),
		readJson(paths.workflowLockPath, "BYZ workflow lock"),
		inspectWorkflowCheckout(workflowId, parsed.root, options.runCommand),
	]);
	await assertRequiredFiles(checkout, workflowLock.workflows[workflowId]);
	const plan = createWorkflowSyncPlan({ byzPackageJson, checkout, workflowId, workflowLock });
	write(`${contract.name}: ${plan.currentVersion} -> ${plan.nextVersion} (${plan.commit.slice(0, 12)})`);
	if (!parsed.apply) {
		write(`Inspect the checkout, then apply with: npm run byz:sync-${workflowId} -- --root <path> --apply`);
		return { ...plan, status: "planned" };
	}
	await assertApplyRepositoryState(repositoryRoot, options.runCommand);
	await applyPlan(plan, paths, options);
	write(`Synchronized ${contract.name} metadata for the next BYZ release.`);
	write("No commit, push, pull request, tag, or publication was performed.");
	return { ...plan, status: "applied" };
}

async function main() {
	const [workflowId, ...argv] = process.argv.slice(2);
	await runWorkflowSync({ argv, workflowId });
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
