import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONFIG_DIR_NAME, DefaultPackageManager, SettingsManager } from "../dist/runtime/bundle/index.js";
import { getWorkflowInstallRequest, prepareWorkflowRuntimeArgs } from "../dist/workflows.js";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(packageDir, "dist", "cli.js");
const CM_ENTRY_SKILLS = ["cm-ai", "cm-check", "cm-fix", "cm-idea", "cm-init", "cm-prd", "cm-refactor", "cm-test"];

function runByz(args, homeDir, extraEnv = {}) {
	return spawnSync(process.execPath, [cliPath, ...args], {
		encoding: "utf8",
		env: { ...process.env, HOME: homeDir, ...extraEnv },
	});
}

function prepareArgsInByzHome(args, homeDir) {
	const moduleUrl = pathToFileURL(join(packageDir, "dist", "workflows.js")).href;
	const script = `const workflows = await import(${JSON.stringify(moduleUrl)}); console.log(JSON.stringify(await workflows.prepareWorkflowRuntimeArgs(${JSON.stringify(args)})));`;
	return spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
		encoding: "utf8",
		env: { ...process.env, HOME: homeDir },
	});
}

async function createWorkflowFixture(baseDir, id) {
	const root = join(baseDir, id);
	if (id === "cm") {
		for (const skillName of CM_ENTRY_SKILLS) {
			await mkdir(join(root, "skills", skillName), { recursive: true });
			await writeFile(
				join(root, "skills", skillName, "SKILL.md"),
				`---\nname: ${skillName}\ndescription: Test ${skillName}\n---\n# ${skillName}\n`,
			);
		}
		await mkdir(join(root, "compat", "claude-commands"), { recursive: true });
		await writeFile(join(root, "compat", "claude-commands", "cm-check.md"), "# CM Check\n");
	} else {
		await mkdir(join(root, "commands"), { recursive: true });
		await mkdir(join(root, "skills", "cm-plugin-check"), { recursive: true });
		await writeFile(join(root, "commands", "cm-plugin:check.md"), "# CM Plugin Check\n");
		await writeFile(
			join(root, "skills", "cm-plugin-check", "SKILL.md"),
			"---\nname: cm-plugin-check\ndescription: Test plugin check\n---\n# CM Plugin Check\n",
		);
	}
	await writeFile(join(root, "VERSION"), id === "cm" ? "0.10.5\n" : "0.6.0\n");
	return root;
}

async function createManagedPluginFixture(baseDir) {
	const root = await createWorkflowFixture(join(baseDir, "owner"), "cm-plugin");
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({
			name: "@aibyzero/cm-plugin-workflow",
			version: "0.5.0",
			private: true,
			pi: { prompts: ["./commands"], skills: ["./skills"] },
		}),
	);
	for (const args of [
		["init"],
		["config", "user.email", "byz-test@example.invalid"],
		["config", "user.name", "BYZ Test"],
		["add", "."],
		["commit", "-m", "test fixture"],
	]) {
		const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
	}
	const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
	const port = await new Promise((resolvePort, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			server.close(() => resolvePort(address.port));
		});
	});
	const daemon = spawn(
		"git",
		[
			"daemon",
			"--reuseaddr",
			"--export-all",
			`--base-path=${baseDir}`,
			"--listen=127.0.0.1",
			`--port=${port}`,
			baseDir,
		],
		{ stdio: "ignore" },
	);
	const repositoryUrl = `git://127.0.0.1:${port}/owner/cm-plugin`;
	for (let attempt = 0; attempt < 20; attempt++) {
		const ready = spawnSync("git", ["ls-remote", repositoryUrl], { encoding: "utf8", timeout: 500 });
		if (ready.status === 0) return { daemon, source: `git:${repositoryUrl}@${revision}` };
		await new Promise((resolveWait) => setTimeout(resolveWait, 25));
	}
	daemon.kill();
	throw new Error("Test Git daemon did not become ready.");
}

test("reports the BYZ package version", async () => {
	const homeDir = await mkdtemp(join(tmpdir(), "byz-home-"));
	const packageJson = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
	const result = runByz(["--version"], homeDir);

	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.trim(), packageJson.version);
});

test("uses an isolated BYZ configuration directory", () => {
	assert.equal(CONFIG_DIR_NAME, ".byz");
});

test("uses the BYZ command identity in help", async () => {
	const homeDir = await mkdtemp(join(tmpdir(), "byz-home-"));
	const result = runByz(["--help"], homeDir);

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /^byz - AI coding assistant/m);
	assert.match(result.stdout, /Usage:\n {2}byz /);
	assert.match(result.stderr, /BYZ updates: byz update/);
	assert.match(result.stderr, /--workflow <cm\|cm-plugin\|none>/);
	assert.match(result.stderr, /workflow <list\|status\|check\|install>/);
});

test("ships the documentation paths referenced by the Pi runtime", async () => {
	await readFile(join(packageDir, "docs", "providers.md"), "utf8");
	await readFile(join(packageDir, "examples", "README.md"), "utf8");
});

test("ships runtime assets at the package-root paths expected by Pi", async () => {
	for (const relativePath of [
		["dist", "modes", "interactive", "theme", "dark.json"],
		["dist", "modes", "interactive", "theme", "light.json"],
		["dist", "modes", "interactive", "theme", "theme-schema.json"],
		["dist", "modes", "interactive", "assets", "clankolas.png"],
		["dist", "core", "export-html", "template.html"],
		["dist", "core", "export-html", "template.css"],
		["dist", "core", "export-html", "template.js"],
		["dist", "core", "export-html", "vendor", "marked.min.js"],
		["dist", "core", "export-html", "vendor", "highlight.min.js"],
	]) {
		await access(join(packageDir, ...relativePath));
	}
});

test("does not delegate updates to the Pi release channel", async () => {
	const homeDir = await mkdtemp(join(tmpdir(), "byz-home-"));
	for (const args of [
		["update", "--help"],
		["--workflow", "none", "update", "--help"],
		["--workflow=cm", "update", "--help"],
	]) {
		const result = runByz(args, homeDir);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /Usage: byz update/);
		assert.match(result.stdout, /@aibyzero\/byz/);
		assert.doesNotMatch(result.stdout, /Update pi, installed packages/);
	}
});

test("does not expose end-user workflow update or rollback commands", async () => {
	const homeDir = await mkdtemp(join(tmpdir(), "byz-home-"));
	for (const command of ["update", "rollback"]) {
		const result = runByz(["workflow", command, "cm"], homeDir);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Expected list, status, check, or install/);
	}
});

test("loads the bundled CM package without a global install", async () => {
	const homeDir = await mkdtemp(join(tmpdir(), "byz-home-"));
	const result = runByz(["workflow", "status", "cm"], homeDir, {
		BYZ_CM_PLUGIN_WORKFLOW_ROOT: "",
		BYZ_CM_WORKFLOW_ROOT: "",
	});

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /cm: available/);
	assert.match(result.stdout, /source: bundled/);
	assert.match(result.stdout, /version: 0\.10\.4/);
});

test("injects only the selected workflow resources", async () => {
	const fixtureDir = await mkdtemp(join(tmpdir(), "byz-workflows-"));
	const cmRoot = await createWorkflowFixture(fixtureDir, "cm");
	const pluginRoot = await createWorkflowFixture(fixtureDir, "cm-plugin");
	const previousCmRoot = process.env.BYZ_CM_WORKFLOW_ROOT;
	const previousPluginRoot = process.env.BYZ_CM_PLUGIN_WORKFLOW_ROOT;
	process.env.BYZ_CM_WORKFLOW_ROOT = cmRoot;
	process.env.BYZ_CM_PLUGIN_WORKFLOW_ROOT = pluginRoot;
	try {
		const resolvedCmRoot = await realpath(cmRoot);
		const resolvedPluginRoot = await realpath(pluginRoot);
		const cm = await prepareWorkflowRuntimeArgs(["--workflow", "cm", "--mode", "rpc"]);
		assert.equal(cm.workflowId, "cm");
		const cmSkillPaths = cm.args.filter((_arg, index) => cm.args[index - 1] === "--skill");
		assert.equal(cmSkillPaths.length, CM_ENTRY_SKILLS.length);
		assert.ok(cmSkillPaths.includes(join(resolvedCmRoot, "skills", "cm-check")));
		assert.ok(cm.args.includes(join(resolvedCmRoot, "compat", "claude-commands")));
		assert.ok(!cm.args.some((arg) => arg.includes("cm-plugin")));

		const plugin = await prepareWorkflowRuntimeArgs(["--workflow=cm-plugin", "--mode", "rpc"]);
		assert.equal(plugin.workflowId, "cm-plugin");
		assert.ok(plugin.args.includes(join(resolvedPluginRoot, "skills")));
		assert.ok(plugin.args.includes(join(resolvedPluginRoot, "commands")));
		assert.ok(!plugin.args.includes(join(resolvedCmRoot, "skills")));
	} finally {
		if (previousCmRoot === undefined) delete process.env.BYZ_CM_WORKFLOW_ROOT;
		else process.env.BYZ_CM_WORKFLOW_ROOT = previousCmRoot;
		if (previousPluginRoot === undefined) delete process.env.BYZ_CM_PLUGIN_WORKFLOW_ROOT;
		else process.env.BYZ_CM_PLUGIN_WORKFLOW_ROOT = previousPluginRoot;
	}
});

test("supports an explicit no-workflow mode", async () => {
	const prepared = await prepareWorkflowRuntimeArgs(["--workflow", "none", "--mode", "rpc"]);
	assert.equal(prepared.workflowId, "none");
	assert.deepEqual(prepared.args, ["--mode", "rpc"]);
});

test("preserves Pi's double-dash argument terminator", async () => {
	const separated = await prepareWorkflowRuntimeArgs(["-p", "--", "--workflow", "none"]);
	assert.equal(separated.workflowId, "cm");
	assert.deepEqual(separated.args.slice(-4), ["-p", "--", "--workflow", "none"]);

	const equalsForm = await prepareWorkflowRuntimeArgs(["-p", "--", "--workflow=none"]);
	assert.equal(equalsForm.workflowId, "cm");
	assert.deepEqual(equalsForm.args.slice(-3), ["-p", "--", "--workflow=none"]);
});

test("respects Pi resource disable flags", async () => {
	const prepared = await prepareWorkflowRuntimeArgs([
		"--workflow",
		"cm",
		"--no-skills",
		"--no-prompt-templates",
		"--mode",
		"rpc",
	]);
	assert.ok(!prepared.args.includes("--skill"));
	assert.ok(!prepared.args.includes("--prompt-template"));
	assert.deepEqual(prepared.args, ["--no-skills", "--no-prompt-templates", "--mode", "rpc"]);
});

test("keeps the private plugin install source separate", async () => {
	const previousSource = process.env.BYZ_CM_PLUGIN_WORKFLOW_SOURCE;
	try {
		delete process.env.BYZ_CM_PLUGIN_WORKFLOW_SOURCE;
		await assert.rejects(
			getWorkflowInstallRequest(["workflow", "install", "cm-plugin"]),
			/BYZ_CM_PLUGIN_WORKFLOW_SOURCE/,
		);
		process.env.BYZ_CM_PLUGIN_WORKFLOW_SOURCE = `git:github.com/owner/private@${"a".repeat(40)}`;
		const request = await getWorkflowInstallRequest(["workflow", "install", "cm-plugin"]);
		assert.equal(request.id, "cm-plugin");
		assert.equal(request.source, process.env.BYZ_CM_PLUGIN_WORKFLOW_SOURCE);
		for (const invalidSource of ["git:github.com/owner/private@abc1234", `/tmp/private-workflow@${"a".repeat(40)}`]) {
			process.env.BYZ_CM_PLUGIN_WORKFLOW_SOURCE = invalidSource;
			await assert.rejects(
				getWorkflowInstallRequest(["workflow", "install", "cm-plugin"]),
				/must be a Git source pinned to a full 40-character commit SHA/,
			);
		}
		await assert.rejects(getWorkflowInstallRequest(["workflow", "install", "cm"]), /bundled with BYZ/);
	} finally {
		if (previousSource === undefined) delete process.env.BYZ_CM_PLUGIN_WORKFLOW_SOURCE;
		else process.env.BYZ_CM_PLUGIN_WORKFLOW_SOURCE = previousSource;
	}
});

test("installs the private plugin disabled and loads it only by explicit workflow selection", async () => {
	const homeDir = await mkdtemp(join(tmpdir(), "byz-home-"));
	const fixtureDir = await mkdtemp(join(tmpdir(), "byz-workflows-"));
	const plugin = await createManagedPluginFixture(fixtureDir);
	try {
		const installResult = runByz(["workflow", "install", "cm-plugin"], homeDir, {
			BYZ_CM_PLUGIN_WORKFLOW_SOURCE: plugin.source,
		});
		assert.equal(installResult.status, 0, installResult.stderr);
		assert.match(installResult.stdout, /autoload disabled/);

		const statusResult = runByz(["workflow", "status", "cm-plugin"], homeDir);
		assert.equal(statusResult.status, 0, statusResult.stderr);
		assert.match(statusResult.stdout, /cm-plugin: available/);
		assert.match(statusResult.stdout, /source: managed/);
		assert.match(statusResult.stdout, /version: 0\.5\.0/);
		assert.equal(
			await access(join(homeDir, ".codex")).then(
				() => true,
				() => false,
			),
			false,
		);

		const agentDir = join(homeDir, ".byz", "agent");
		const settingsManager = SettingsManager.create(process.cwd(), agentDir);
		const packageManager = new DefaultPackageManager({ cwd: process.cwd(), agentDir, settingsManager });
		const resolved = await packageManager.resolve();
		assert.ok(!resolved.skills.some((resource) => resource.enabled && resource.metadata.source === plugin.source));
		assert.ok(!resolved.prompts.some((resource) => resource.enabled && resource.metadata.source === plugin.source));

		const checkResult = runByz(["workflow", "check", "cm-plugin"], homeDir);
		assert.equal(checkResult.status, 0, checkResult.stderr);
		const configured = packageManager
			.listConfiguredPackages()
			.find((candidate) => candidate.source === plugin.source);
		assert.ok(configured?.installedPath);
		const preparedResult = prepareArgsInByzHome(["--workflow", "cm-plugin", "--mode", "rpc"], homeDir);
		assert.equal(preparedResult.status, 0, preparedResult.stderr);
		const prepared = JSON.parse(preparedResult.stdout);
		assert.ok(prepared.args.includes(join(await realpath(configured.installedPath), "skills")));
		assert.ok(prepared.args.includes(join(await realpath(configured.installedPath), "commands")));

		const originalSettings = settingsManager.getGlobalSettings().packages;
		const packageJsonPath = join(configured.installedPath, "package.json");
		const originalPackageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

		settingsManager.setPackages([{ source: plugin.source, autoload: true }]);
		await settingsManager.flush();
		const autoloadResult = runByz(["workflow", "check", "cm-plugin"], homeDir);
		assert.equal(autoloadResult.status, 1);
		assert.match(autoloadResult.stderr, /autoload disabled/);
		settingsManager.setPackages(originalSettings);
		await settingsManager.flush();

		const wrongCommit = plugin.source.replace(/[0-9a-f]{40}$/i, "f".repeat(40));
		settingsManager.setPackages([{ source: wrongCommit, autoload: false }]);
		await settingsManager.flush();
		const headResult = runByz(["workflow", "check", "cm-plugin"], homeDir);
		assert.equal(headResult.status, 1);
		assert.match(headResult.stderr, /source mismatch/);
		settingsManager.setPackages(originalSettings);
		await settingsManager.flush();

		await writeFile(
			packageJsonPath,
			JSON.stringify({ ...originalPackageJson, pi: { ...originalPackageJson.pi, skills: ["./wrong"] } }),
		);
		const manifestResult = runByz(["workflow", "check", "cm-plugin"], homeDir);
		assert.equal(manifestResult.status, 1);
		assert.match(manifestResult.stderr, /Pi manifest does not match/);

		await writeFile(packageJsonPath, JSON.stringify({ ...originalPackageJson, name: "@invalid/private-workflow" }));
		const packageResult = runByz(["workflow", "check", "cm-plugin"], homeDir);
		assert.equal(packageResult.status, 1);
		assert.match(packageResult.stderr, /unavailable/);
		await writeFile(packageJsonPath, JSON.stringify(originalPackageJson));
	} finally {
		plugin.daemon.kill();
	}
});

test("does not publish the private workflow repository identity", async () => {
	const lock = JSON.parse(await readFile(join(packageDir, "workflows.lock.json"), "utf8"));
	assert.equal(lock.workflows["cm-plugin"].source, undefined);
	assert.equal(lock.workflows["cm-plugin"].sourceEnv, "BYZ_CM_PLUGIN_WORKFLOW_SOURCE");
});

test("checks both workflow roots independently", async () => {
	const homeDir = await mkdtemp(join(tmpdir(), "byz-home-"));
	const fixtureDir = await mkdtemp(join(tmpdir(), "byz-workflows-"));
	const cmRoot = await createWorkflowFixture(fixtureDir, "cm");
	const pluginRoot = await createWorkflowFixture(fixtureDir, "cm-plugin");
	const env = {
		BYZ_CM_PLUGIN_WORKFLOW_ROOT: pluginRoot,
		BYZ_CM_WORKFLOW_ROOT: cmRoot,
	};

	const cmResult = runByz(["workflow", "check", "cm"], homeDir, env);
	const pluginResult = runByz(["workflow", "check", "cm-plugin"], homeDir, env);

	assert.equal(cmResult.status, 0, cmResult.stderr);
	assert.match(cmResult.stdout, /cm: check passed/);
	assert.doesNotMatch(cmResult.stdout, /cm-plugin/);
	assert.equal(pluginResult.status, 0, pluginResult.stderr);
	assert.match(pluginResult.stdout, /cm-plugin: check passed/);
});

test("does not fall back to the sibling workflow", async () => {
	const homeDir = await mkdtemp(join(tmpdir(), "byz-home-"));
	const fixtureDir = await mkdtemp(join(tmpdir(), "byz-workflows-"));
	const cmRoot = join(fixtureDir, "broken-cm");
	await mkdir(cmRoot, { recursive: true });
	await writeFile(join(cmRoot, "VERSION"), "0.10.5\n");
	const pluginRoot = await createWorkflowFixture(fixtureDir, "cm-plugin");

	const result = runByz(["workflow", "check", "cm"], homeDir, {
		BYZ_CM_PLUGIN_WORKFLOW_ROOT: pluginRoot,
		BYZ_CM_WORKFLOW_ROOT: cmRoot,
	});

	assert.equal(result.status, 1);
	assert.match(result.stderr, /CM Workflow is incomplete/);
});

test("rejects a shared workflow root", async () => {
	const homeDir = await mkdtemp(join(tmpdir(), "byz-home-"));
	const fixtureDir = await mkdtemp(join(tmpdir(), "byz-workflows-"));
	const sharedRoot = await createWorkflowFixture(fixtureDir, "cm");

	const result = runByz(["workflow", "list"], homeDir, {
		BYZ_CM_PLUGIN_WORKFLOW_ROOT: sharedRoot,
		BYZ_CM_WORKFLOW_ROOT: sharedRoot,
	});

	assert.equal(result.status, 1);
	assert.match(result.stderr, /Workflow isolation violation/);
});

test("rejects nested workflow roots", async () => {
	const homeDir = await mkdtemp(join(tmpdir(), "byz-home-"));
	const fixtureDir = await mkdtemp(join(tmpdir(), "byz-workflows-"));
	const cmRoot = await createWorkflowFixture(fixtureDir, "cm");
	const pluginRoot = await createWorkflowFixture(cmRoot, "cm-plugin");

	const result = runByz(["workflow", "list"], homeDir, {
		BYZ_CM_PLUGIN_WORKFLOW_ROOT: pluginRoot,
		BYZ_CM_WORKFLOW_ROOT: cmRoot,
	});

	assert.equal(result.status, 1);
	assert.match(result.stderr, /Workflow isolation violation/);
});

test("rejects workflow directories without Pi-loadable resources", async () => {
	const homeDir = await mkdtemp(join(tmpdir(), "byz-home-"));
	const fixtureDir = await mkdtemp(join(tmpdir(), "byz-workflows-"));
	const pluginRoot = join(fixtureDir, "empty-plugin");
	await mkdir(join(pluginRoot, "skills"), { recursive: true });
	await mkdir(join(pluginRoot, "commands"), { recursive: true });
	await writeFile(join(pluginRoot, "VERSION"), "0.5.0\n");
	await writeFile(join(pluginRoot, "commands", "cm-plugin:check.md"), "# Required but no skills\n");

	const result = runByz(["workflow", "check", "cm-plugin"], homeDir, {
		BYZ_CM_PLUGIN_WORKFLOW_ROOT: pluginRoot,
	});

	assert.equal(result.status, 1);
	assert.match(result.stderr, /no Pi-loadable resources/);
});
