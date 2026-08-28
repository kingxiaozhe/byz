import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { findPublicPackageViolations } from "./check-byz-public-package.mjs";

async function createPackage(t, files) {
	const root = await mkdtemp(join(tmpdir(), "byz-public-package-"));
	t.after(() => rm(root, { force: true, recursive: true }));
	for (const [path, content] of Object.entries(files)) {
		const target = join(root, path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, content);
	}
	return root;
}

function workflowRecord(id, overrides = {}) {
	const cm = id === "cm";
	return {
		packageName: cm ? "@aibyzero/cm-workflow" : "@aibyzero/cm-plugin-workflow",
		source: `github:kingxiaozhe/${cm ? "cm-workflow" : "cm-plugin-workflow"}#${cm ? "a" : "b"}`.padEnd(
			`github:kingxiaozhe/${cm ? "cm-workflow" : "cm-plugin-workflow"}#`.length + 40,
			cm ? "a" : "b",
		),
		bundled: true,
		bundledPath: `workflows/${id}`,
		requiredFiles: cm ? ["VERSION", "skills/cm-check/SKILL.md"] : ["VERSION", "commands/cm-plugin:check.md"],
		...overrides,
	};
}

function workflowLock(overrides = {}) {
	return `${JSON.stringify(
		{
			schemaVersion: 1,
			workflows: {
				cm: workflowRecord("cm", overrides.cm),
				"cm-plugin": workflowRecord("cm-plugin", overrides["cm-plugin"]),
			},
		},
		null,
		2,
	)}\n`;
}

function completePackage(lock = workflowLock()) {
	return {
		"workflows.lock.json": lock,
		"workflows/cm/VERSION": "0.10.4\n",
		"workflows/cm/skills/cm-check/SKILL.md": "# CM Check\n",
		"workflows/cm-plugin/VERSION": "0.5.0\n",
		"workflows/cm-plugin/commands/cm-plugin:check.md": "# CM Plugin Check\n",
	};
}

test("accepts two complete pinned bundled workflows", async (t) => {
	const root = await createPackage(t, completePackage());
	assert.deepEqual(await findPublicPackageViolations(root), []);
});

test("accepts the repository's current workflow lock contract", async (t) => {
	const lock = await readFile(new URL("../packages/byz/workflows.lock.json", import.meta.url), "utf8");
	const root = await createPackage(t, completePackage(lock));
	assert.deepEqual(await findPublicPackageViolations(root), []);
});

test("rejects malformed or incomplete workflow locks", async (t) => {
	for (const content of ['{"workflows":', "{}", '{"schemaVersion":1,"workflows":{}}']) {
		const root = await createPackage(t, { "workflows.lock.json": content });
		assert.equal((await findPublicPackageViolations(root))[0]?.pattern, "invalid BYZ workflow lock", content);
	}
});

test("rejects a workflow that is not bundled", async (t) => {
	const root = await createPackage(t, completePackage(workflowLock({ "cm-plugin": { bundled: false } })));
	assert.equal((await findPublicPackageViolations(root))[0]?.pattern, "workflow must be bundled");
});

test("rejects an unpinned workflow source", async (t) => {
	const root = await createPackage(t, completePackage(workflowLock({ cm: { source: "github:owner/cm#main" } })));
	assert.equal((await findPublicPackageViolations(root))[0]?.pattern, "workflow source is not pinned");
});

test("rejects overlapping workflow bundle roots", async (t) => {
	const lock = workflowLock({ "cm-plugin": { bundledPath: "workflows/cm/plugin" } });
	const root = await createPackage(t, completePackage(lock));
	assert.equal((await findPublicPackageViolations(root))[0]?.pattern, "workflow bundle roots overlap");
});

test("rejects a missing required bundled file", async (t) => {
	const files = completePackage();
	delete files["workflows/cm-plugin/commands/cm-plugin:check.md"];
	const root = await createPackage(t, files);
	assert.equal((await findPublicPackageViolations(root))[0]?.pattern, "missing bundled workflow file");
});
