import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const syncVersionsScript = fileURLToPath(new URL("./sync-versions.js", import.meta.url));

async function writeManifest(root, relativeDirectory, manifest) {
	const directory = join(root, relativeDirectory);
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
}

async function readManifest(root, relativeDirectory) {
	return JSON.parse(await readFile(join(root, relativeDirectory, "package.json"), "utf8"));
}

function runSyncVersions(root) {
	return spawnSync(process.execPath, [syncVersionsScript, join(root, "packages")], {
		cwd: root,
		encoding: "utf8",
	});
}

test("synchronizes private dependencies without touching registry aliases, generated manifests, or published lockstep", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-sync-versions-"));
	try {
		await writeManifest(root, "packages/ai", {
			name: "@earendil-works/pi-ai",
			version: "2.0.0",
		});
		await writeManifest(root, "packages/coding-agent", {
			name: "@earendil-works/pi-coding-agent",
			version: "2.0.0",
		});
		await writeManifest(root, "packages/evals", {
			name: "@earendil-works/pi-evals",
			version: "9.9.9",
			private: true,
			dependencies: {
				"@earendil-works/pi-coding-agent": "^1.0.0",
				"@mariozechner/pi-ai": "npm:@earendil-works/pi-ai@1.0.0",
			},
		});
		await writeManifest(root, "packages/coding-agent/install-lock", {
			name: "generated-install-lock",
			version: "0.0.0",
			private: true,
			dependencies: {
				"@earendil-works/pi-coding-agent": "^1.0.0",
			},
		});

		const result = runSyncVersions(root);
		assert.equal(result.status, 0, result.stderr);

		const evalsManifest = await readManifest(root, "packages/evals");
		assert.equal(evalsManifest.dependencies["@earendil-works/pi-coding-agent"], "^2.0.0");
		assert.equal(evalsManifest.dependencies["@mariozechner/pi-ai"], "npm:@earendil-works/pi-ai@1.0.0");
		const generatedManifest = await readManifest(root, "packages/coding-agent/install-lock");
		assert.equal(generatedManifest.dependencies["@earendil-works/pi-coding-agent"], "^1.0.0");

		await writeManifest(root, "packages/ai", {
			name: "@earendil-works/pi-ai",
			version: "3.0.0",
		});
		const lockstepFailure = runSyncVersions(root);
		assert.equal(lockstepFailure.status, 1, lockstepFailure.stderr);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("ignores built package images under .byz-output", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-sync-versions-image-"));
	try {
		await writeManifest(root, "packages/ai", {
			name: "@earendil-works/pi-ai",
			version: "2.0.0",
		});
		await writeManifest(root, "packages/byz", {
			name: "@aibyzero/byz",
			version: "2.0.0",
		});
		// A BYZ build leaves a full package image, package.json copies included, under .byz-output.
		// Counting those copies duplicates packages and breaks the lockstep check on a clean tree.
		const imageDirectory = "packages/byz/.byz-output/generations/generation-test/package";
		await writeManifest(root, imageDirectory, {
			name: "@aibyzero/byz",
			version: "9.9.9",
			dependencies: {
				"@earendil-works/pi-ai": "^1.0.0",
			},
		});

		const result = runSyncVersions(root);
		assert.equal(result.status, 0, result.stderr);
		assert.ok(!result.stdout.includes("9.9.9"), result.stdout);

		const imageManifest = await readManifest(root, imageDirectory);
		assert.equal(imageManifest.dependencies["@earendil-works/pi-ai"], "^1.0.0");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("keeps independently released packages out of the lockstep check", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-sync-versions-independent-"));
	try {
		await writeManifest(root, "packages/ai", {
			name: "@earendil-works/pi-ai",
			version: "2.0.0",
		});
		await writeManifest(root, "packages/tui", {
			name: "@earendil-works/pi-tui",
			version: "2.0.0",
		});
		// BYZ ships on its own version line, so its version must not fail the lockstep check.
		await writeManifest(root, "packages/byz", {
			name: "@aibyzero/byz",
			version: "0.1.13",
		});

		const result = runSyncVersions(root);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /@aibyzero\/byz: 0\.1\.13 \(independent release, not lockstep\)/);

		// A genuine lockstep break must still fail.
		await writeManifest(root, "packages/tui", {
			name: "@earendil-works/pi-tui",
			version: "3.0.0",
		});
		const lockstepFailure = runSyncVersions(root);
		assert.equal(lockstepFailure.status, 1, lockstepFailure.stdout);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
