import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { runWorkflowSync } from "./byz-sync-workflow.mjs";

function command(cwd, executable, args) {
	return execFileSync(executable, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function git(cwd, ...args) {
	return command(cwd, "git", args);
}

async function write(path, content) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content);
}

async function createGitRepository(t, prefix, branch = "feature/test") {
	const root = await mkdtemp(join(tmpdir(), prefix));
	t.after(() => rm(root, { force: true, recursive: true }));
	git(root, "init", "-b", branch);
	git(root, "config", "user.name", "BYZ Test");
	git(root, "config", "user.email", "byz-test@example.invalid");
	return root;
}

function commitAll(root, message) {
	git(root, "add", "--all");
	git(root, "commit", "-m", message);
	return git(root, "rev-parse", "HEAD");
}

async function createWorkflow(t, id, version) {
	const root = await createGitRepository(t, `byz-sync-${id}-`);
	const cm = id === "cm";
	const skills = cm ? ["./skills/cm-ai", "./skills/cm-check"] : ["./skills"];
	const prompts = cm ? ["./compat/claude-commands"] : ["./commands"];
	const packageJson = {
		name: cm ? "@aibyzero/cm-workflow" : "@aibyzero/cm-plugin-workflow",
		version,
		license: cm ? "MIT" : "UNLICENSED",
		pi: { prompts, skills },
	};
	await write(join(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
	await write(join(root, "VERSION"), `${version}\n`);
	for (const skill of skills) await write(join(root, skill, "SKILL.md"), `# ${skill}\n`);
	await write(join(root, prompts[0], cm ? "cm-check.md" : "cm-plugin:check.md"), "# Check\n");
	commitAll(root, `${id} ${version}`);
	return root;
}

async function createByzFixture(t, branch = "feature/test") {
	const root = await createGitRepository(t, "byz-sync-repo-", branch);
	const byzPackage = {
		name: "@aibyzero/byz",
		devDependencies: {
			"@aibyzero/cm-workflow": `github:kingxiaozhe/cm-workflow#${"a".repeat(40)}`,
		},
	};
	const workflowLock = {
		schemaVersion: 1,
		workflows: {
			cm: {
				name: "CM Workflow",
				packageName: "@aibyzero/cm-workflow",
				version: "0.10.4",
				source: `github:kingxiaozhe/cm-workflow#${"a".repeat(40)}`,
				license: "MIT",
				bundled: true,
				bundledPath: "workflows/cm",
				envRoot: "BYZ_CM_WORKFLOW_ROOT",
				skillsPaths: ["skills/cm-check"],
				promptsPath: "compat/claude-commands",
				requiredFiles: ["VERSION", "skills/cm-check/SKILL.md"],
			},
			"cm-plugin": {
				name: "CM Plugin Workflow",
				packageName: "@aibyzero/cm-plugin-workflow",
				version: "0.5.0",
				bundled: false,
				private: true,
				sourceEnv: "BYZ_CM_PLUGIN_WORKFLOW_SOURCE",
				envRoot: "BYZ_CM_PLUGIN_WORKFLOW_ROOT",
				skillsPaths: ["skills"],
				promptsPath: "commands",
				requiredFiles: ["VERSION", "commands/cm-plugin:check.md"],
			},
		},
	};
	await write(join(root, "packages/byz/package.json"), `${JSON.stringify(byzPackage, null, "\t")}\n`);
	await write(join(root, "packages/byz/workflows.lock.json"), `${JSON.stringify(workflowLock, null, "\t")}\n`);
	await write(join(root, "package-lock.json"), '{"lockfileVersion":3}\n');
	commitAll(root, "BYZ fixture");
	return root;
}

test("plans CM synchronization without changing BYZ files", async (t) => {
	const byz = await createByzFixture(t);
	const workflow = await createWorkflow(t, "cm", "0.10.5");
	const before = await readFile(join(byz, "packages/byz/workflows.lock.json"), "utf8");
	const output = [];
	const result = await runWorkflowSync({
		argv: ["--root", workflow],
		repositoryRoot: byz,
		workflowId: "cm",
		write: (message) => output.push(message),
	});
	assert.equal(result.status, "planned");
	assert.equal(result.nextVersion, "0.10.5");
	assert.match(result.nextWorkflowLock.workflows.cm.source, new RegExp(`${result.commit}$`));
	assert.equal(await readFile(join(byz, "packages/byz/workflows.lock.json"), "utf8"), before);
	assert.match(output.join("\n"), /--apply/);
});

test("root package exposes maintainer-only synchronization entrypoints", async () => {
	const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	assert.equal(packageJson.scripts["byz:sync-cm"], "node scripts/byz-sync-workflow.mjs cm");
	assert.equal(packageJson.scripts["byz:sync-cm-plugin"], "node scripts/byz-sync-workflow.mjs cm-plugin");
});

test("applies bundled CM metadata and requests a lockfile refresh", async (t) => {
	const byz = await createByzFixture(t);
	const workflow = await createWorkflow(t, "cm", "0.10.5");
	let refreshes = 0;
	const result = await runWorkflowSync({
		argv: ["--root", workflow, "--apply"],
		refreshLockfile: () => {
			refreshes += 1;
		},
		repositoryRoot: byz,
		workflowId: "cm",
		write() {},
	});
	const byzPackage = JSON.parse(await readFile(join(byz, "packages/byz/package.json"), "utf8"));
	const lock = JSON.parse(await readFile(join(byz, "packages/byz/workflows.lock.json"), "utf8"));
	assert.equal(result.status, "applied");
	assert.equal(refreshes, 1);
	assert.equal(lock.workflows.cm.version, "0.10.5");
	assert.deepEqual(lock.workflows.cm.skillsPaths, ["skills/cm-ai", "skills/cm-check"]);
	assert.equal(byzPackage.devDependencies["@aibyzero/cm-workflow"], lock.workflows.cm.source);
	assert.match(lock.workflows.cm.source, new RegExp(`${result.commit}$`));
});

test("applies private plugin compatibility without persisting private source metadata", async (t) => {
	const byz = await createByzFixture(t);
	const workflow = await createWorkflow(t, "cm-plugin", "0.6.0");
	let refreshes = 0;
	const result = await runWorkflowSync({
		argv: ["--root", workflow, "--apply"],
		refreshLockfile: () => {
			refreshes += 1;
		},
		repositoryRoot: byz,
		workflowId: "cm-plugin",
		write() {},
	});
	const content = await readFile(join(byz, "packages/byz/workflows.lock.json"), "utf8");
	const plugin = JSON.parse(content).workflows["cm-plugin"];
	assert.equal(result.status, "applied");
	assert.equal(refreshes, 0);
	assert.equal(plugin.version, "0.6.0");
	assert.deepEqual(plugin.skillsPaths, ["skills"]);
	assert.equal(plugin.promptsPath, "commands");
	assert.doesNotMatch(content, new RegExp(workflow.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	for (const key of ["source", "repository", "repo", "commit", "revision", "sha"]) {
		assert.equal(plugin[key], undefined, key);
	}
});

test("rejects unapproved private source metadata before writing", async (t) => {
	for (const [key, value] of Object.entries({
		checkoutPath: "/private/cm-plugin",
		installSource: "ssh://private/cm-plugin",
		metadata: { repositoryUrl: "ssh://private/cm-plugin" },
		repositoryUrl: "ssh://private/cm-plugin",
	})) {
		const byz = await createByzFixture(t);
		const workflow = await createWorkflow(t, "cm-plugin", "0.6.0");
		const lockPath = join(byz, "packages/byz/workflows.lock.json");
		const lock = JSON.parse(await readFile(lockPath, "utf8"));
		lock.workflows["cm-plugin"][key] = value;
		await writeFile(lockPath, `${JSON.stringify(lock, null, "\t")}\n`);
		commitAll(byz, `add invalid private metadata ${key}`);
		await assert.rejects(
			runWorkflowSync({
				argv: ["--root", workflow, "--apply"],
				repositoryRoot: byz,
				workflowId: "cm-plugin",
				write() {},
			}),
			new RegExp(`Private workflow lock must not contain ${key}`),
		);
	}
});

test("rejects noncanonical private workflow contract values", async (t) => {
	for (const [key, value] of Object.entries({
		envRoot: "/private/cm-plugin",
		sourceEnv: "ssh://private/cm-plugin",
	})) {
		const byz = await createByzFixture(t);
		const workflow = await createWorkflow(t, "cm-plugin", "0.6.0");
		const lockPath = join(byz, "packages/byz/workflows.lock.json");
		const lock = JSON.parse(await readFile(lockPath, "utf8"));
		lock.workflows["cm-plugin"][key] = value;
		await writeFile(lockPath, `${JSON.stringify(lock, null, "\t")}\n`);
		commitAll(byz, `add noncanonical private value ${key}`);
		await assert.rejects(
			runWorkflowSync({
				argv: ["--root", workflow, "--apply"],
				repositoryRoot: byz,
				workflowId: "cm-plugin",
				write() {},
			}),
			new RegExp(`Private workflow lock ${key} must equal the BYZ contract value`),
		);
	}
});

test("rejects declared workflow resources that do not exist", async (t) => {
	const byz = await createByzFixture(t);
	const workflow = await createWorkflow(t, "cm", "0.10.5");
	const packagePath = join(workflow, "package.json");
	const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
	packageJson.pi.skills = ["./skills/cm-check", "./skills/missing"];
	await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
	commitAll(workflow, "declare missing resource");
	await assert.rejects(
		runWorkflowSync({ argv: ["--root", workflow], repositoryRoot: byz, workflowId: "cm", write() {} }),
		/CM Workflow pi\.skills does not exist: skills\/missing/,
	);
});

test("rejects workflow resource path traversal", async (t) => {
	const byz = await createByzFixture(t);
	const workflow = await createWorkflow(t, "cm", "0.10.5");
	const packagePath = join(workflow, "package.json");
	const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
	packageJson.pi.skills = ["../outside"];
	await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
	commitAll(workflow, "declare traversing resource");
	await assert.rejects(
		runWorkflowSync({ argv: ["--root", workflow], repositoryRoot: byz, workflowId: "cm", write() {} }),
		/CM Workflow pi\.skills contains an unsafe path: \.\.\/outside/,
	);
});

test("rejects workflow resource symlinks that escape the checkout", async (t) => {
	const byz = await createByzFixture(t);
	const workflow = await createWorkflow(t, "cm", "0.10.5");
	const outside = await mkdtemp(join(tmpdir(), "byz-sync-outside-"));
	t.after(() => rm(outside, { force: true, recursive: true }));
	await write(join(outside, "SKILL.md"), "# Outside\n");
	await symlink(outside, join(workflow, "skills", "escaped"), "dir");
	const packagePath = join(workflow, "package.json");
	const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
	packageJson.pi.skills = ["./skills/escaped"];
	await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
	commitAll(workflow, "declare escaping resource symlink");
	await assert.rejects(
		runWorkflowSync({ argv: ["--root", workflow], repositoryRoot: byz, workflowId: "cm", write() {} }),
		/CM Workflow pi\.skills resolves outside the workflow checkout: skills\/escaped/,
	);
});

test("rejects dirty workflow checkouts and apply operations on BYZ main", async (t) => {
	const dirtyByz = await createByzFixture(t);
	const dirtyWorkflow = await createWorkflow(t, "cm", "0.10.5");
	await write(join(dirtyWorkflow, "dirty.txt"), "dirty\n");
	await assert.rejects(
		runWorkflowSync({ argv: ["--root", dirtyWorkflow], repositoryRoot: dirtyByz, workflowId: "cm", write() {} }),
		/checkout must be clean/,
	);

	const mainByz = await createByzFixture(t, "main");
	const cleanWorkflow = await createWorkflow(t, "cm", "0.10.5");
	await assert.rejects(
		runWorkflowSync({
			argv: ["--root", cleanWorkflow, "--apply"],
			repositoryRoot: mainByz,
			workflowId: "cm",
			write() {},
		}),
		/feature branch/,
	);
});

test("restores BYZ metadata if the CM lockfile refresh fails", async (t) => {
	const byz = await createByzFixture(t);
	const workflow = await createWorkflow(t, "cm", "0.10.5");
	const packagePath = join(byz, "packages/byz/package.json");
	const packageLockPath = join(byz, "package-lock.json");
	const lockPath = join(byz, "packages/byz/workflows.lock.json");
	const beforePackage = await readFile(packagePath, "utf8");
	const beforePackageLock = await readFile(packageLockPath, "utf8");
	const beforeLock = await readFile(lockPath, "utf8");
	await assert.rejects(
		runWorkflowSync({
			argv: ["--root", workflow, "--apply"],
			refreshLockfile: async () => {
				await writeFile(packageLockPath, '{"partiallyChanged":true}\n');
				throw new Error("lock refresh failed");
			},
			repositoryRoot: byz,
			workflowId: "cm",
			write() {},
		}),
		/lock refresh failed/,
	);
	assert.equal(await readFile(packagePath, "utf8"), beforePackage);
	assert.equal(await readFile(packageLockPath, "utf8"), beforePackageLock);
	assert.equal(await readFile(lockPath, "utf8"), beforeLock);
});
