import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { prepareFastRuntimeArgs, selectFastRuntimeArgs } from "../.byz-output/current/dist/fast.js";
import { CONFIG_DIR_NAME } from "../.byz-output/current/dist/runtime/bundle/index.js";
import { prepareWorkflowRuntimeArgs } from "../.byz-output/current/dist/workflows.js";

const sourcePackageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const packageDir = join(sourcePackageDir, ".byz-output", "current");
const cliPath = join(packageDir, "dist", "cli.js");
const CM_ENTRY_SKILLS = ["cm-ai", "cm-check", "cm-fix", "cm-idea", "cm-init", "cm-prd", "cm-refactor", "cm-test"];

function runByz(args, homeDir, extraEnv = {}) {
	const env = Object.fromEntries(
		Object.entries({ ...process.env, HOME: homeDir, ...extraEnv }).filter(([, value]) => value !== undefined),
	);
	return spawnSync(process.execPath, [cliPath, ...args], {
		encoding: "utf8",
		env,
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
	assert.doesNotMatch(result.stderr, /Fast|Prewalk|workflow|model|skill/i);
});

test("applies Fast defaults without removing workflow resources", async () => {
	const fast = prepareFastRuntimeArgs(["--fast", "--workflow", "cm", "--mode", "rpc"], {
		BYZ_FAST_MODEL: "openai/example-fast",
	});
	const prepared = await prepareWorkflowRuntimeArgs(fast.args);

	assert.equal(fast.enabled, true);
	assert.equal(fast.model, "openai/example-fast");
	assert.equal(fast.thinking, "low");
	assert.equal(prepared.workflowId, "cm");
	assert.ok(prepared.args.includes("--skill"));
	assert.ok(prepared.args.includes("--prompt-template"));
	assert.deepEqual(prepared.args.slice(-6), ["--model", "openai/example-fast", "--thinking", "low", "--mode", "rpc"]);
});

test("defers Fast defaults to the extension only for interactive sessions", () => {
	const fast = prepareFastRuntimeArgs(["--fast", "--workflow", "cm"], {
		BYZ_FAST_MODEL: "openai/example-fast",
	});

	assert.deepEqual(selectFastRuntimeArgs(fast, { isInteractive: true, loadWorkflow: true }), ["--workflow", "cm"]);
	assert.deepEqual(selectFastRuntimeArgs(fast, { isInteractive: false, loadWorkflow: true }), [
		"--model",
		"openai/example-fast",
		"--thinking",
		"low",
		"--workflow",
		"cm",
	]);
	assert.equal(fast.useConfiguredModel, true);
	assert.equal(fast.useLowThinking, true);
});

test("gives explicit model and thinking options priority over Fast defaults", () => {
	const prepared = prepareFastRuntimeArgs(
		["--fast", "--model", "anthropic/explicit", "--thinking", "medium", "prompt"],
		{ BYZ_FAST_MODEL: "openai/example-fast" },
	);

	assert.deepEqual(prepared.args, ["--model", "anthropic/explicit", "--thinking", "medium", "prompt"]);
	assert.equal(prepared.model, "anthropic/explicit");
	assert.equal(prepared.thinking, "medium");
	assert.equal(prepared.useConfiguredModel, false);
	assert.equal(prepared.useLowThinking, false);
});

test("preserves an explicit thinking suffix on the selected model", () => {
	const prepared = prepareFastRuntimeArgs(["--fast", "--model", "anthropic/sonnet:high", "prompt"], {
		BYZ_FAST_MODEL: "openai/example-fast",
	});

	assert.deepEqual(prepared.args, ["--model", "anthropic/sonnet:high", "prompt"]);
	assert.equal(prepared.model, "anthropic/sonnet:high");
	assert.equal(prepared.thinking, "high");
});

test("keeps the saved model when Fast resumes an existing session", () => {
	for (const sessionArgs of [["--continue"], ["-c"], ["--resume"], ["-r"], ["--session", "session-id"]]) {
		const prepared = prepareFastRuntimeArgs(["--fast", ...sessionArgs], {
			BYZ_FAST_MODEL: "openai/example-fast",
		});
		assert.equal(prepared.model, "session");
		assert.equal(prepared.useConfiguredModel, false);
		assert.equal(prepared.useLowThinking, true);
		assert.ok(!prepared.args.includes("openai/example-fast"));
		assert.deepEqual(prepared.args.slice(0, 2), ["--thinking", "low"]);
	}
});

test("ignores BYZ_FAST_MODEL outside Fast mode", () => {
	const prepared = prepareFastRuntimeArgs(["--mode", "rpc"], { BYZ_FAST_MODEL: "openai/example-fast" });
	assert.equal(prepared.enabled, false);
	assert.deepEqual(prepared.args, ["--mode", "rpc"]);
});

test("preserves --fast after Pi's double-dash argument terminator", () => {
	const prepared = prepareFastRuntimeArgs(["-p", "--", "--fast"]);
	assert.equal(prepared.enabled, false);
	assert.deepEqual(prepared.args, ["-p", "--", "--fast"]);
});

test("preserves --fast when Pi consumes it as a mode value", () => {
	const prepared = prepareFastRuntimeArgs(["--mode", "--fast", "hello"]);
	assert.equal(prepared.enabled, false);
	assert.deepEqual(prepared.args, ["--mode", "--fast", "hello"]);
});

test("rejects duplicate or valued Fast options", () => {
	assert.throws(() => prepareFastRuntimeArgs(["--fast", "--fast"]), /may only be specified once/);
	assert.throws(() => prepareFastRuntimeArgs(["--fast=on"]), /does not accept a value/);
});

test("does not reorder Pi-owned commands in Fast mode", async () => {
	const homeDir = await mkdtemp(join(tmpdir(), "byz-home-"));
	const result = runByz(["--fast", "auth", "--help"], homeDir);

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Usage:\n {2}pi auth print-api-key/);
	assert.doesNotMatch(result.stdout, /^byz - AI coding assistant/m);
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
		assert.match(result.stderr, /Expected list, status, or check/);
	}
});

test("loads both bundled workflow packages without global installs", async () => {
	const homeDir = await mkdtemp(join(tmpdir(), "byz-home-"));
	for (const [id, version] of [
		["cm", "0.10.4"],
		["cm-plugin", "0.5.0"],
	]) {
		const result = runByz(["workflow", "status", id], homeDir, {
			BYZ_CM_PLUGIN_WORKFLOW_ROOT: "",
			BYZ_CM_WORKFLOW_ROOT: "",
		});
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, new RegExp(`${id}: available`));
		assert.match(result.stdout, /source: bundled/);
		assert.match(result.stdout, new RegExp(`version: ${version.replaceAll(".", "\\.")}`));
	}
});

test("reports the effective workflow when status has no target", async () => {
	const homeDir = await mkdtemp(join(tmpdir(), "byz-home-"));
	const cases = [
		{
			args: ["workflow", "status"],
			env: { BYZ_WORKFLOW: undefined },
			expected: /cm: available/,
		},
		{
			args: ["workflow", "status"],
			env: { BYZ_WORKFLOW: "cm-plugin" },
			expected: /cm-plugin: available/,
		},
		{
			args: ["--workflow", "cm-plugin", "workflow", "status"],
			env: { BYZ_WORKFLOW: "cm" },
			expected: /cm-plugin: available/,
		},
		{
			args: ["--workflow", "cm-plugin", "workflow", "status", "cm"],
			env: { BYZ_WORKFLOW: "cm-plugin" },
			expected: /cm: available/,
		},
		{
			args: ["--workflow", "none", "workflow", "status"],
			env: {},
			expected: /none: active/,
		},
		{
			args: ["--workflow", "cm-plugin", "workflow", "status", "none"],
			env: {},
			expected: /none: available/,
		},
	];

	for (const testCase of cases) {
		const result = runByz(testCase.args, homeDir, testCase.env);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, testCase.expected);
	}
});

test("reports an effective none workflow without validating unrelated roots", async () => {
	const homeDir = await mkdtemp(join(tmpdir(), "byz-home-"));
	const fixtureDir = await mkdtemp(join(tmpdir(), "byz-workflows-"));
	const sharedRoot = await createWorkflowFixture(fixtureDir, "cm");
	const result = runByz(["--workflow", "none", "workflow", "status"], homeDir, {
		BYZ_CM_PLUGIN_WORKFLOW_ROOT: sharedRoot,
		BYZ_CM_WORKFLOW_ROOT: sharedRoot,
	});

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /none: active/);
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

test("preserves --workflow when Pi consumes it as a mode value", async () => {
	const prepared = await prepareWorkflowRuntimeArgs(["--mode", "--workflow", "cm-plugin"]);
	assert.equal(prepared.workflowId, "cm");
	assert.deepEqual(prepared.args.slice(-3), ["--mode", "--workflow", "cm-plugin"]);
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

test("does not expose separate installation for bundled workflows", async () => {
	const homeDir = await mkdtemp(join(tmpdir(), "byz-home-"));
	for (const id of ["cm", "cm-plugin"]) {
		const result = runByz(["workflow", "install", id], homeDir);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Expected list, status, or check/);
	}
});

test("locks both bundled workflow sources to full commits", async () => {
	const lock = JSON.parse(await readFile(join(packageDir, "workflows.lock.json"), "utf8"));
	for (const id of ["cm", "cm-plugin"]) {
		assert.equal(lock.workflows[id].bundled, true);
		assert.match(lock.workflows[id].source, /#[0-9a-f]{40}$/);
	}
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
