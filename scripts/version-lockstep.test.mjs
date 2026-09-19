import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const versionLockstepScript = fileURLToPath(new URL("./version-lockstep.mjs", import.meta.url));

async function writeManifest(root, relativeDirectory, manifest) {
	const directory = join(root, relativeDirectory);
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
}

async function readVersion(root, relativeDirectory) {
	return JSON.parse(await readFile(join(root, relativeDirectory, "package.json"), "utf8")).version;
}

async function createFixture() {
	const root = await mkdtemp(join(tmpdir(), "pi-version-lockstep-"));
	await writeFile(
		join(root, "package.json"),
		`${JSON.stringify({ name: "fixture-root", private: true, workspaces: ["packages/*"] }, null, "\t")}\n`,
	);
	await writeManifest(root, "packages/ai", { name: "@earendil-works/pi-ai", version: "1.0.0" });
	await writeManifest(root, "packages/tui", { name: "@earendil-works/pi-tui", version: "1.0.0" });
	await writeManifest(root, "packages/byz", { name: "@aibyzero/byz", version: "0.1.13" });
	return root;
}

function runVersionLockstep(root, ...args) {
	return spawnSync(process.execPath, [versionLockstepScript, ...args], { cwd: root, encoding: "utf8" });
}

test("bumps lockstep packages and leaves independently released packages alone", async () => {
	const root = await createFixture();
	try {
		const result = runVersionLockstep(root, "patch", "--no-git-tag-version", "--no-workspaces-update");
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /Skipping @aibyzero\/byz \(independent release line\)\./);

		assert.equal(await readVersion(root, "packages/ai"), "1.0.1");
		assert.equal(await readVersion(root, "packages/tui"), "1.0.1");
		assert.equal(await readVersion(root, "packages/byz"), "0.1.13");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("accepts an explicit version target after the forwarded flags", async () => {
	const root = await createFixture();
	try {
		const result = runVersionLockstep(root, "--no-git-tag-version", "--no-workspaces-update", "2.5.0");
		assert.equal(result.status, 0, result.stderr);

		assert.equal(await readVersion(root, "packages/ai"), "2.5.0");
		assert.equal(await readVersion(root, "packages/byz"), "0.1.13");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects an invocation without exactly one version target", async () => {
	const root = await createFixture();
	try {
		const missing = runVersionLockstep(root, "--no-git-tag-version");
		assert.equal(missing.status, 1, missing.stdout);
		assert.match(missing.stderr, /Usage: node scripts\/version-lockstep\.mjs/);

		const ambiguous = runVersionLockstep(root, "patch", "2.5.0");
		assert.equal(ambiguous.status, 1, ambiguous.stdout);

		assert.equal(await readVersion(root, "packages/ai"), "1.0.0");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
