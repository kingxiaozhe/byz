import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
	ARTIFACT_LIMITS,
	captureArtifact,
	inspectTarHeaders,
	validateImageAgainstReceipt,
	verifyArtifact,
} from "../packages/byz/scripts/artifact.mjs";
import {
	inspectCurrentNpmPackManifest,
	packCurrentByzImage,
	parsePackArguments,
	validateReceiptAgainstNpmManifest,
} from "../packages/byz/scripts/pack.mjs";
import {
	createByzDryRunArtifact,
	createByzReleasePlan,
	parseByzReleaseTag,
	publishValidatedByzArtifact,
	releasePublishLock,
	validateByzPublishState,
	validateByzTarballManifest,
} from "./byz-release.mjs";

const byzPackageDir = fileURLToPath(new URL("../packages/byz/", import.meta.url));

function writeTarOctal(header, offset, length, value) {
	const encoded = value.toString(8).padStart(length - 1, "0");
	header.write(encoded, offset, length - 1, "ascii");
	header[offset + length - 1] = 0;
}

function createTarHeader({ name, size = 0, type = "0" }) {
	const header = Buffer.alloc(512);
	header.write(name, 0, 100, "utf8");
	writeTarOctal(header, 100, 8, 0o644);
	writeTarOctal(header, 108, 8, 0);
	writeTarOctal(header, 116, 8, 0);
	writeTarOctal(header, 124, 12, size);
	writeTarOctal(header, 136, 12, 0);
	header.fill(0x20, 148, 156);
	header.write(type, 156, 1, "ascii");
	header.write("ustar\0", 257, 6, "ascii");
	header.write("00", 263, 2, "ascii");
	let checksum = 0;
	for (const byte of header) checksum += byte;
	const encodedChecksum = checksum.toString(8).padStart(6, "0");
	header.write(encodedChecksum, 148, 6, "ascii");
	header[154] = 0;
	header[155] = 0x20;
	return header;
}

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

test("packs receipt-bound private artifacts across generation switches and stale source output", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "byz-release-image-"));
	t.after(() => rm(root, { force: true, recursive: true }));
	const packageDir = join(root, "package");
	const outputDir = join(packageDir, ".byz-output");
	const firstImage = join(outputDir, "generations", "first", "package");
	const secondImage = join(outputDir, "generations", "second", "package");
	const firstDestination = join(root, "first-pack");
	const secondDestination = join(root, "second-pack");
	const currentImage = await realpath(join(byzPackageDir, ".byz-output", "current"));
	await Promise.all([
		mkdir(join(outputDir, "generations"), { recursive: true }),
		mkdir(join(packageDir, "dist"), { recursive: true }),
		mkdir(firstDestination, { recursive: true }),
		mkdir(secondDestination, { recursive: true }),
	]);
	await Promise.all([
		cp(currentImage, firstImage, { recursive: true }),
		cp(currentImage, secondImage, { recursive: true }),
		cp(join(byzPackageDir, "package.json"), join(packageDir, "package.json")),
	]);
	await Promise.all([
		writeFile(join(firstImage, "README.md"), "first generation\n"),
		writeFile(join(secondImage, "README.md"), "second generation\n"),
		writeFile(join(packageDir, "dist", "stale-source-marker.txt"), "must not be packed\n"),
	]);
	await symlink("generations/first/package", join(outputDir, "current"), "dir");

	const first = await packCurrentByzImage({ args: ["--pack-destination", firstDestination], packageDir });
	await rm(join(outputDir, "current"));
	await symlink("generations/second/package", join(outputDir, "current"), "dir");
	const second = await packCurrentByzImage({ args: [`--pack-destination=${secondDestination}`], packageDir });
	const firstReceipt = JSON.parse(await readFile(first.receiptPath, "utf8"));
	const secondReceipt = JSON.parse(await readFile(second.receiptPath, "utf8"));
	assert.equal(firstReceipt.generationIdentity, "generations/first/package");
	assert.equal(secondReceipt.generationIdentity, "generations/second/package");
	const secondNpmManifest = inspectCurrentNpmPackManifest(secondImage, packageDir);
	validateReceiptAgainstNpmManifest(secondReceipt, secondNpmManifest);
	const incompleteReceipt = structuredClone(secondReceipt);
	const removedEntry = incompleteReceipt.entries.findLast((entry) => entry.type === "file");
	incompleteReceipt.entries = incompleteReceipt.entries.filter((entry) => entry !== removedEntry);
	incompleteReceipt.totalBytes -= removedEntry.size;
	assert.throws(
		() => validateReceiptAgainstNpmManifest(incompleteReceipt, secondNpmManifest),
		/does not contain the complete npm package manifest/,
	);
	const resolvedFirstDestination = await realpath(firstDestination);
	const resolvedSecondDestination = await realpath(secondDestination);
	assert.ok(dirname(first.artifactPath).startsWith(`${resolvedFirstDestination}/byz-artifact-`));
	assert.ok(dirname(second.artifactPath).startsWith(`${resolvedSecondDestination}/byz-artifact-`));
	assert.notEqual(dirname(first.artifactPath), resolvedFirstDestination);
	assert.equal((await stat(dirname(first.artifactPath))).mode & 0o777, 0o700);
	assert.equal((await stat(first.artifactPath)).mode & 0o777, 0o600);
	assert.equal((await stat(first.receiptPath)).mode & 0o777, 0o600);
	await validateImageAgainstReceipt(firstImage, firstReceipt);
	await validateImageAgainstReceipt(secondImage, secondReceipt);
	assert.doesNotMatch(execFileSync("tar", ["-tzf", first.artifactPath], { encoding: "utf8" }), /stale-source-marker/);

	const firstVerified = await verifyArtifact({ receiptPath: first.receiptPath, tarballPath: first.artifactPath });
	t.after(() => firstVerified.captured.release());
	const mismatchedReceiptPath = join(root, "mismatched-receipt.json");
	const mismatchedReceipt = structuredClone(firstReceipt);
	const firstFile = mismatchedReceipt.entries.find((entry) => entry.type === "file");
	firstFile.size += 1;
	await writeFile(mismatchedReceiptPath, `${JSON.stringify(mismatchedReceipt)}\n`);
	await assert.rejects(
		verifyArtifact({ receiptPath: mismatchedReceiptPath, tarballPath: first.artifactPath }),
		/Invalid BYZ artifact receipt total size/,
	);
	assert.equal(
		execFileSync("tar", ["-xOf", firstVerified.captured.snapshotPath, "package/README.md"], { encoding: "utf8" }),
		"first generation\n",
	);
	const tarballLink = join(root, "tarball-link.tgz");
	const receiptLink = join(root, "receipt-link.json");
	await Promise.all([symlink(first.artifactPath, tarballLink), symlink(first.receiptPath, receiptLink)]);
	await assert.rejects(verifyArtifact({ receiptPath: first.receiptPath, tarballPath: tarballLink }), /non-symlink/);
	await assert.rejects(
		verifyArtifact({ receiptPath: receiptLink, tarballPath: first.artifactPath }),
		/receipt must not be a symbolic link/,
	);
	await assert.rejects(
		verifyArtifact({
			expectedGenerationIdentity: firstReceipt.generationIdentity,
			expectedSha256: firstReceipt.tarball.sha256,
			receiptPath: second.receiptPath,
			tarballPath: second.artifactPath,
		}),
		/does not match the expected release dry-run identity/,
	);
	await cp(second.artifactPath, first.artifactPath, { force: true });
	await assert.rejects(
		verifyArtifact({ receiptPath: first.receiptPath, tarballPath: first.artifactPath }),
		/artifact bytes do not match/,
	);
	const postSmoke = await verifyArtifact({
		receiptPath: first.receiptPath,
		tarballPath: firstVerified.captured.snapshotPath,
	});
	await postSmoke.captured.release();
	await writeFile(join(firstImage, "README.md"), "mutated after pack\n");
	await assert.rejects(
		validateImageAgainstReceipt(firstImage, firstReceipt),
		/current image content does not match its receipt: README.md/,
	);

	await assert.rejects(
		packCurrentByzImage({ args: ["--pack-destination", join(outputDir, "current")], packageDir }),
		/artifact base directory must be outside the immutable output root/,
	);
	const escapedDestination = join(root, "escaped-destination");
	await symlink(join(outputDir, "current"), escapedDestination, "dir");
	await assert.rejects(
		packCurrentByzImage({ args: ["--pack-destination", escapedDestination], packageDir }),
		/artifact base directory must be outside the immutable output root/,
	);
	const safeDestination = join(root, "safe-retarget-base");
	const retargetedDestination = join(root, "retargeted-destination");
	await mkdir(safeDestination);
	await symlink(safeDestination, retargetedDestination, "dir");
	const retargetedPack = await packCurrentByzImage({
		args: ["--pack-destination", retargetedDestination],
		async onArtifactDirectoryReady() {
			await rm(retargetedDestination);
			await symlink(join(outputDir, "current"), retargetedDestination, "dir");
		},
		packageDir,
	});
	assert.ok(retargetedPack.artifactPath.startsWith(`${await realpath(safeDestination)}/byz-artifact-`));
	assert.equal(await realpath(join(outputDir, "current")), await realpath(secondImage));

	const resolvedSecondImage = await realpath(secondImage);
	const resolvedOutputDir = await realpath(outputDir);
	let substitutedPublishCalled = false;
	await assert.rejects(
		publishValidatedByzArtifact({
			currentImage: { imageDir: resolvedSecondImage, outputDir: resolvedOutputDir },
			expectedGenerationIdentity: firstReceipt.generationIdentity,
			expectedSha256: firstReceipt.tarball.sha256,
			packageDir,
			plan: { packageName: secondReceipt.package.name, version: secondReceipt.package.version },
			async publish() {
				substitutedPublishCalled = true;
			},
			publishLock: { async assertOwner() {} },
			receiptPath: second.receiptPath,
			tarballPath: second.artifactPath,
		}),
		/does not match the expected release dry-run identity/,
	);
	assert.equal(substitutedPublishCalled, false);

	let publishedSnapshot;
	let ownershipChecks = 0;
	await publishValidatedByzArtifact({
		currentImage: { imageDir: resolvedSecondImage, outputDir: resolvedOutputDir },
		expectedGenerationIdentity: secondReceipt.generationIdentity,
		expectedSha256: secondReceipt.tarball.sha256,
		packageDir,
		plan: { packageName: secondReceipt.package.name, version: secondReceipt.package.version },
		async publish(snapshotPath) {
			publishedSnapshot = snapshotPath;
			assert.notEqual(snapshotPath, second.artifactPath);
			assert.ok((await stat(snapshotPath)).isFile());
		},
		publishLock: {
			async assertOwner() {
				ownershipChecks += 1;
			},
		},
		receiptPath: second.receiptPath,
		tarballPath: second.artifactPath,
	});
	assert.equal(ownershipChecks, 2);
	assert.ok(publishedSnapshot);
	let lostOwnershipChecks = 0;
	let publishWasCalled = false;
	await assert.rejects(
		publishValidatedByzArtifact({
			currentImage: { imageDir: resolvedSecondImage, outputDir: resolvedOutputDir },
			expectedGenerationIdentity: secondReceipt.generationIdentity,
			expectedSha256: secondReceipt.tarball.sha256,
			packageDir,
			plan: { packageName: secondReceipt.package.name, version: secondReceipt.package.version },
			async publish() {
				publishWasCalled = true;
			},
			publishLock: {
				async assertOwner() {
					lostOwnershipChecks += 1;
					if (lostOwnershipChecks === 2) throw new Error("simulated publish lock loss");
				},
			},
			receiptPath: second.receiptPath,
			tarballPath: second.artifactPath,
		}),
		/simulated publish lock loss/,
	);
	assert.equal(publishWasCalled, true);
	await assert.rejects(releasePublishLock(async () => false), /publish lock ownership was lost/);

	const publishedMetadataPath = join(secondImage, "package.json");
	const publishedMetadata = JSON.parse(await readFile(publishedMetadataPath, "utf8"));
	publishedMetadata.publishConfig = { access: "restricted" };
	await writeFile(publishedMetadataPath, `${JSON.stringify(publishedMetadata)}\n`);
	await assert.rejects(
		packCurrentByzImage({ args: ["--pack-destination", secondDestination], packageDir }),
		/metadata does not match the deterministic workspace transformation/,
	);
	assert.throws(() => parsePackArguments(["../../other-package"]), /Unsupported BYZ pack argument/);
	assert.throws(() => parsePackArguments(["--workspace", "other"]), /Unsupported BYZ pack argument/);
	assert.throws(() => parsePackArguments(["--dry-run"]), /Unsupported BYZ pack argument/);
});

test("release dry-run keeps one artifact lineage under the build lock", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "byz-release-lineage-"));
	t.after(() => rm(root, { force: true, recursive: true }));
	const packageDir = join(root, "package");
	const outputDir = join(packageDir, ".byz-output");
	const firstImage = join(outputDir, "generations", "first", "package");
	const secondImage = join(outputDir, "generations", "second", "package");
	const destination = join(root, "artifacts");
	const currentImage = await realpath(join(byzPackageDir, ".byz-output", "current"));
	await Promise.all([mkdir(join(outputDir, "generations"), { recursive: true }), mkdir(destination)]);
	await Promise.all([
		cp(currentImage, firstImage, { recursive: true }),
		cp(currentImage, secondImage, { recursive: true }),
		cp(join(byzPackageDir, "package.json"), join(packageDir, "package.json")),
	]);
	await Promise.all([
		writeFile(join(firstImage, "README.md"), "first generation\n"),
		writeFile(join(secondImage, "README.md"), "second generation\n"),
	]);
	await symlink("generations/first/package", join(outputDir, "current"), "dir");

	const completed = await createByzDryRunArtifact({
		args: ["--pack-destination", destination],
		packageDir,
	});
	const output = JSON.parse(completed.output);
	assert.deepEqual(output, {
		artifactPath: completed.artifactPath,
		generationIdentity: "generations/first/package",
		receiptPath: completed.receiptPath,
		sha256: completed.sha256,
	});
	const verified = await verifyArtifact({ receiptPath: output.receiptPath, tarballPath: output.artifactPath });
	assert.equal(verified.sha256, output.sha256);
	await verified.captured.release();
	const deliveredEntries = new Set(await readdir(destination));

	await assert.rejects(
		createByzDryRunArtifact({
			args: ["--pack-destination", destination],
			async onArtifactPacked() {
				await rm(join(outputDir, "current"));
				await symlink("generations/second/package", join(outputDir, "current"), "dir");
			},
			packageDir,
		}),
		/current (?:package )?image|receipt/,
	);
	assert.deepEqual(new Set(await readdir(destination)), deliveredEntries);

	await rm(join(outputDir, "current"));
	await symlink("generations/first/package", join(outputDir, "current"), "dir");
	await assert.rejects(
		createByzDryRunArtifact({
			args: ["--pack-destination", destination],
			async onArtifactPacked() {
				const lockRoot = join(outputDir, ".build-locks-v3");
				for (const entry of await readdir(lockRoot)) {
					await rm(join(lockRoot, entry), { force: true, recursive: true });
				}
			},
			packageDir,
		}),
	);
	assert.deepEqual(new Set(await readdir(destination)), deliveredEntries);
});

test("rejects oversized and special tar entries from headers before payload expansion", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "byz-tar-limits-"));
	t.after(() => rm(root, { force: true, recursive: true }));
	const oversized = join(root, "oversized.tgz");
	const special = join(root, "special.tgz");
	const duplicate = join(root, "duplicate.tgz");
	const totalExpansion = join(root, "total-expansion.tgz");
	const fileAncestor = join(root, "file-ancestor.tgz");
	const growing = join(root, "growing.tgz");
	const danglingLongName = join(root, "dangling-long-name.tgz");
	const nonZeroPadding = join(root, "non-zero-padding.tgz");
	const regularWithSlash = join(root, "regular-with-slash.tgz");
	const end = Buffer.alloc(1024);
	await Promise.all([
		writeFile(
			oversized,
			gzipSync(
				Buffer.concat([
					createTarHeader({ name: "package/bomb.bin", size: ARTIFACT_LIMITS.maxSingleFileBytes + 1 }),
					end,
				]),
			),
		),
		writeFile(
			special,
			gzipSync(Buffer.concat([createTarHeader({ name: "package/link", type: "2" }), end])),
		),
		writeFile(
			duplicate,
			gzipSync(
				Buffer.concat([
					createTarHeader({ name: "package/repeated" }),
					createTarHeader({ name: "package/repeated" }),
					end,
				]),
			),
		),
		writeFile(
			totalExpansion,
			gzipSync(
				Buffer.concat([
					createTarHeader({ name: "package/one", size: 8 }),
					Buffer.alloc(512),
					createTarHeader({ name: "package/two", size: 8 }),
					Buffer.alloc(512),
					end,
				]),
			),
		),
		writeFile(
			fileAncestor,
			gzipSync(
				Buffer.concat([
					createTarHeader({ name: "package/file" }),
					createTarHeader({ name: "package/file/child" }),
					end,
				]),
			),
		),
		writeFile(growing, Buffer.alloc(128 * 1024)),
		writeFile(danglingLongName, gzipSync(Buffer.concat([createTarHeader({ name: "long", type: "L" }), end]))),
		writeFile(
			nonZeroPadding,
			gzipSync(
				Buffer.concat([
					createTarHeader({ name: "package/padded", size: 1 }),
					Buffer.from([0, 1, ...new Array(510).fill(0)]),
					end,
				]),
			),
		),
		writeFile(regularWithSlash, gzipSync(Buffer.concat([createTarHeader({ name: "package/file/" }), end]))),
	]);
	await assert.rejects(inspectTarHeaders(oversized), /file exceeds its size limit/);
	await assert.rejects(inspectTarHeaders(special), /link or special entry/);
	await assert.rejects(inspectTarHeaders(duplicate), /duplicate path/);
	await assert.rejects(inspectTarHeaders(fileAncestor), /file is an ancestor/);
	await assert.rejects(inspectTarHeaders(danglingLongName), /complete end marker/);
	await assert.rejects(inspectTarHeaders(nonZeroPadding), /non-zero entry padding/);
	await assert.rejects(inspectTarHeaders(regularWithSlash), /unsafe path/);
	let appended = false;
	await assert.rejects(
		captureArtifact(growing, {
			async onChunk() {
				if (appended) return;
				appended = true;
				await appendFile(growing, Buffer.alloc(128 * 1024));
			},
		}),
		/grew beyond its capture limit/,
	);
	await assert.rejects(
		inspectTarHeaders(totalExpansion, { ...ARTIFACT_LIMITS, maxSingleFileBytes: 10, maxTotalBytes: 12 }),
		/total expansion limit/,
	);
	await assert.rejects(
		inspectTarHeaders(totalExpansion, { ...ARTIFACT_LIMITS, maxEntries: 1, maxSingleFileBytes: 10 }),
		/entry-count limit/,
	);
});

test("BYZ release workflow cannot invoke Pi publication machinery", async () => {
	const [workflow, releaseScript] = await Promise.all([
		readFile(new URL("../.github/workflows/byz-release.yml", import.meta.url), "utf8"),
		readFile(new URL("./byz-release.mjs", import.meta.url), "utf8"),
	]);
	assert.match(workflow, /byz-v\*/);
	assert.match(workflow, /npm run hydrate:model-data/);
	assert.match(workflow, /npm run build:byz:offline/);
	assert.match(workflow, /node scripts\/byz-release\.mjs/);
	assert.match(workflow, /node scripts\/check-byz-public-package\.mjs/);
	assert.match(workflow, /--publish "\$BYZ_TARBALL" --receipt "\$BYZ_RECEIPT"/);
	assert.match(workflow, /node scripts\/byz-release\.mjs --tag "\$GITHUB_REF_NAME" --pack-destination/);
	assert.equal(
		workflow.match(/node scripts\/byz-release\.mjs --tag "\$GITHUB_REF_NAME" --pack-destination/g)?.length,
		1,
	);
	assert.doesNotMatch(workflow, /node packages\/byz\/scripts\/pack\.mjs/);
	assert.match(workflow, /BYZ_GENERATION_IDENTITY=\$generation_identity/);
	assert.match(workflow, /BYZ_ARTIFACT_SHA256=\$artifact_sha256/);
	assert.equal(workflow.match(/--expected-generation "\$BYZ_GENERATION_IDENTITY"/g)?.length, 3);
	assert.equal(workflow.match(/--expected-sha256 "\$BYZ_ARTIFACT_SHA256"/g)?.length, 3);
	assert.match(workflow, /node packages\/byz\/scripts\/verify-artifact\.mjs/);
	assert.ok(workflow.indexOf("verify-artifact.mjs --tarball") < workflow.indexOf('tar -xzf "$smoke_tarball"'));
	assert.match(workflow, /verify-artifact\.mjs --check-only/);
	assert.doesNotMatch(workflow, /npm pack/);
	assert.match(releaseScript, /packCurrentByzImage/);
	assert.match(releaseScript, /validateCurrentByzImage/);
	assert.match(releaseScript, /verifyArtifact/);
	assert.match(releaseScript, /publishValidatedByzArtifact/);
	assert.doesNotMatch(releaseScript, /args: \["--dry-run"\]/);
	assert.doesNotMatch(releaseScript, /execFileSync\("npm", \["pack"/);
	assert.ok(workflow.indexOf("npm run hydrate:model-data") < workflow.indexOf("npm run build:byz:offline"));
	assert.ok(
		workflow.indexOf("npm@11.16.0") <
			workflow.indexOf('scripts/byz-release.mjs --tag "$GITHUB_REF_NAME" --pack-destination'),
	);
	assert.doesNotMatch(workflow, /scripts\/publish\.mjs/);
	assert.doesNotMatch(workflow, /release:(patch|minor|major)/);
	assert.doesNotMatch(workflow, /build-binaries|publish-release-announcement|pi-model-upload/);
});
