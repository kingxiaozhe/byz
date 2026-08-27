import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	createByzReleasePlan,
	parseByzReleaseTag,
	validateByzPublishState,
	validateByzTarballManifest,
} from "./byz-release.mjs";

test("accepts only a BYZ tag matching the package version", () => {
	assert.equal(parseByzReleaseTag("byz-v0.1.0"), "0.1.0");
	for (const tag of ["v0.1.0", "byz-0.1.0", "byz-vlatest", "byz-v0.1"]) {
		assert.throws(() => parseByzReleaseTag(tag), /Invalid BYZ release tag/);
	}
	assert.throws(
		() => createByzReleasePlan({ tag: "byz-v0.2.0", packageVersion: "0.1.0", publishedVersions: [] }),
		/tag version 0\.2\.0 does not match package version 0\.1\.0/,
	);
});

test("creates exactly one BYZ package release target", () => {
	assert.deepEqual(
		createByzReleasePlan({ tag: "byz-v0.1.0", packageVersion: "0.1.0", publishedVersions: [] }),
		{
			packageDir: "packages/byz",
			packageName: "@aibyzero/byz",
			version: "0.1.0",
		},
	);
	assert.throws(
		() =>
			createByzReleasePlan({
				tag: "byz-v0.1.0",
				packageVersion: "0.1.0",
				publishedVersions: ["0.1.0"],
			}),
		/@aibyzero\/byz@0\.1\.0 is already published/,
	);
});

test("permits publication only from the matching clean main tag in GitHub Actions", () => {
	const validState = {
		githubActions: true,
		githubRefName: "byz-v0.1.0",
		head: "a".repeat(40),
		mainContainsHead: true,
		tag: "byz-v0.1.0",
		tagCommit: "a".repeat(40),
		worktreeClean: true,
	};
	assert.doesNotThrow(() => validateByzPublishState(validState));
	for (const change of [
		{ githubActions: false },
		{ githubRefName: "byz-v0.2.0" },
		{ worktreeClean: false },
		{ tagCommit: "b".repeat(40) },
		{ mainContainsHead: false },
	]) {
		assert.throws(() => validateByzPublishState({ ...validState, ...change }));
	}
});

test("publishes only a tarball with the planned BYZ identity", () => {
	const plan = { packageName: "@aibyzero/byz", version: "0.1.0" };
	assert.doesNotThrow(() => validateByzTarballManifest({ name: "@aibyzero/byz", version: "0.1.0" }, plan));
	assert.throws(
		() => validateByzTarballManifest({ name: "@earendil-works/pi-coding-agent", version: "0.1.0" }, plan),
		/identity does not match/,
	);
	assert.throws(
		() => validateByzTarballManifest({ name: "@aibyzero/byz", version: "0.2.0" }, plan),
		/identity does not match/,
	);
});

test("BYZ release workflow cannot invoke Pi publication machinery", async () => {
	const workflow = await readFile(new URL("../.github/workflows/byz-release.yml", import.meta.url), "utf8");
	assert.match(workflow, /byz-v\*/);
	assert.match(workflow, /npm run hydrate:model-data/);
	assert.match(workflow, /npm run build:byz:offline/);
	assert.match(workflow, /node scripts\/byz-release\.mjs/);
	assert.match(workflow, /node scripts\/check-byz-public-package\.mjs/);
	assert.match(workflow, /--publish "\$BYZ_TARBALL"/);
	assert.equal(workflow.match(/npm pack/g)?.length, 1);
	assert.ok(workflow.indexOf("npm run hydrate:model-data") < workflow.indexOf("npm run build:byz:offline"));
	assert.ok(workflow.indexOf("npm@11.16.0") < workflow.indexOf("npm pack"));
	assert.doesNotMatch(workflow, /scripts\/publish\.mjs/);
	assert.doesNotMatch(workflow, /release:(patch|minor|major)/);
	assert.doesNotMatch(workflow, /build-binaries|publish-release-announcement|pi-model-upload/);
});
