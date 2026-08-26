import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CONFIG_DIR_NAME } from "../dist/runtime/bundle/index.js";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(packageDir, "dist", "cli.js");

function runByz(args, homeDir, extraEnv = {}) {
	return spawnSync(process.execPath, [cliPath, ...args], {
		encoding: "utf8",
		env: { ...process.env, HOME: homeDir, ...extraEnv },
	});
}

async function createWorkflowFixture(baseDir, id) {
	const root = join(baseDir, id);
	if (id === "cm") {
		await mkdir(join(root, "skills", "cm-check"), { recursive: true });
		await writeFile(join(root, "skills", "cm-check", "SKILL.md"), "# CM Check\n");
	} else {
		await mkdir(join(root, "commands"), { recursive: true });
		await writeFile(join(root, "commands", "cm-plugin:check.md"), "# CM Plugin Check\n");
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
	assert.match(result.stdout, /Usage:\n  byz /);
	assert.match(result.stderr, /BYZ update is not available yet/);
});

test("ships the documentation paths referenced by the Pi runtime", async () => {
	await readFile(join(packageDir, "docs", "providers.md"), "utf8");
	await readFile(join(packageDir, "examples", "README.md"), "utf8");
});

test("does not delegate updates to the Pi release channel", async () => {
	const homeDir = await mkdtemp(join(tmpdir(), "byz-home-"));
	const result = runByz(["update"], homeDir);

	assert.equal(result.status, 2);
	assert.match(result.stderr, /BYZ update is not available/);
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
