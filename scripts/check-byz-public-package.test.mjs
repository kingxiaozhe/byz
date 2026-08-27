import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { findPrivateWorkflowLeaks } from "./check-byz-public-package.mjs";

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

function workflowLock(cmPlugin = {}) {
	return `${JSON.stringify(
		{
			schemaVersion: 1,
			workflows: {
				cm: {
					packageName: "@aibyzero/cm-workflow",
					source: "github:kingxiaozhe/cm-workflow#public-commit",
				},
				"cm-plugin": {
					packageName: "@aibyzero/cm-plugin-workflow",
					private: true,
					sourceEnv: "BYZ_CM_PLUGIN_WORKFLOW_SOURCE",
					...cmPlugin,
				},
			},
		},
		null,
		2,
	)}\n`;
}

test("accepts the shipped private workflow placeholder without source metadata", async (t) => {
	const root = await createPackage(t, { "workflows.lock.json": workflowLock() });
	assert.deepEqual(await findPrivateWorkflowLeaks(root), []);
});

test("accepts the repository's current workflow lock", async (t) => {
	const content = await readFile(new URL("../packages/byz/workflows.lock.json", import.meta.url), "utf8");
	const root = await createPackage(t, { "workflows.lock.json": content });
	assert.deepEqual(await findPrivateWorkflowLeaks(root), []);
});

test("rejects forbidden source metadata on the private workflow record", async (t) => {
	for (const key of ["source", "repository", "repo", "commit", "revision", "sha"]) {
		const root = await createPackage(t, { "workflows.lock.json": workflowLock({ [key]: "private-value" }) });
		const leaks = await findPrivateWorkflowLeaks(root);
		assert.equal(leaks.length, 1, key);
		assert.equal(leaks[0].pattern, "private workflow source metadata");
	}
});

test("rejects nested forbidden metadata on a record identified by package name", async (t) => {
	const content = JSON.stringify({
		workflows: {
			"cm-plugin": {
				packageName: "@aibyzero/cm-plugin-workflow",
				private: true,
			},
			optional: {
				metadata: { revision: "a".repeat(40) },
				packageName: "@aibyzero/cm-plugin-workflow",
				private: true,
			},
		},
	});
	const root = await createPackage(t, { "workflows.lock.json": content });
	assert.equal((await findPrivateWorkflowLeaks(root))[0]?.pattern, "private workflow source metadata");
});

test("rejects malformed or structurally invalid shipped workflow locks", async (t) => {
	for (const content of [
		'{"workflows":',
		"{}",
		'{"workflows":[]}',
		'{"workflows":{"cm-plugin":null}}',
		'{"workflows":{"cm-plugin":[]}}',
	]) {
		const root = await createPackage(t, { "workflows.lock.json": content });
		assert.equal((await findPrivateWorkflowLeaks(root))[0]?.pattern, "invalid BYZ workflow lock", content);
	}
});

test("rejects the known private repository identity anywhere in packed content", async (t) => {
	for (const repository of [
		"kingxiaozhe/cm-plugin-workflow",
		"https://github.com/kingxiaozhe/cm-plugin-workflow.git",
		"git@github.com:kingxiaozhe/cm-plugin-workflow.git#main",
		"github:kingxiaozhe/cm-plugin-workflow#main",
		"kingxiaozhe\\cm-plugin-workflow",
		"_git@github.com:kingxiaozhe/cm-plugin-workflow.git_",
	]) {
		const root = await createPackage(t, { "metadata.txt": `${repository}\n` });
		assert.equal((await findPrivateWorkflowLeaks(root)).length, 1, repository);
	}
});

test("rejects an exact private workflow package path", async (t) => {
	const root = await createPackage(t, { "workflows/cm-plugin-workflow/private.js": "export {};\n" });
	assert.equal((await findPrivateWorkflowLeaks(root))[0]?.pattern, "private workflow package path");
});

test("accepts package-name prose, placeholders, and unrelated repositories", async (t) => {
	const root = await createPackage(t, {
		"README.md": [
			"cm-plugin-workflow stays separate and user-configured.",
			"export BYZ_CM_PLUGIN_WORKFLOW_SOURCE='git:git@github.com:OWNER/PRIVATE_REPO@<40-character-commit-sha>'",
			"https://github.com/example/cm-plugin-workflow-docs",
			"https://github.com/example/public?next=/cm-plugin-workflow",
			"git@github.com:other-owner/cm-plugin-workflow.git",
			"ssh://git@private.example/team/cm-plugin-workflow.git",
			"github:other-owner/cm-plugin-workflow#main",
			"git@private.example:cm-plugin-workflow.git",
			"(git@private.example:cm-plugin-workflow.git)",
			"Use git@private.example:cm-plugin-workflow.git.",
			"git@private.example:cm-plugin-workflow.docs",
		].join("\n"),
	});
	assert.deepEqual(await findPrivateWorkflowLeaks(root), []);
});

test("does not interpret arbitrary YAML, JSON5, or JSONC metadata", async (t) => {
	const root = await createPackage(t, {
		"docs/example.json5": '{package:"@aibyzero/cm-plugin-workflow",private:true,}',
		"docs/example.jsonc": '{"package":"@aibyzero/cm-plugin-workflow"} // documentation',
		"docs/example.yml": "package: @aibyzero/cm-plugin-workflow\nprivate: true\n",
	});
	assert.deepEqual(await findPrivateWorkflowLeaks(root), []);
});

test("accepts related path names that are not the private package directory", async (t) => {
	const root = await createPackage(t, { "docs/cm-plugin-workflow-migration.md": "Migration notes only.\n" });
	assert.deepEqual(await findPrivateWorkflowLeaks(root), []);
});
