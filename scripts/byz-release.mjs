#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { valid } from "semver";
import { verifyArtifact } from "../packages/byz/scripts/artifact.mjs";
import { acquireBuildLock } from "../packages/byz/scripts/build-support.mjs";
import {
	packCurrentByzImage,
	validateCurrentByzImage,
	validateReceiptAgainstCurrentImage,
} from "../packages/byz/scripts/pack.mjs";

const currentFile = fileURLToPath(import.meta.url);
const repositoryRoot = dirname(dirname(currentFile));
const packageDir = resolve(repositoryRoot, "packages/byz");
const packageJsonPath = resolve(packageDir, "package.json");
const BYZ_PACKAGE_NAME = "@aibyzero/byz";

export function parseByzReleaseTag(tag) {
	const match = /^byz-v(.+)$/.exec(tag);
	if (!match || valid(match[1]) !== match[1] || `byz-v${match[1]}` !== tag) {
		throw new Error(`Invalid BYZ release tag: ${tag}. Expected byz-v<semver>.`);
	}
	return match[1];
}

export function createByzReleasePlan({ tag, packageVersion, publishedVersions }) {
	const tagVersion = parseByzReleaseTag(tag);
	if (tagVersion !== packageVersion) {
		throw new Error(`BYZ tag version ${tagVersion} does not match package version ${packageVersion}.`);
	}
	if (publishedVersions.includes(packageVersion)) {
		throw new Error(`${BYZ_PACKAGE_NAME}@${packageVersion} is already published.`);
	}
	return {
		packageDir: "packages/byz",
		packageName: BYZ_PACKAGE_NAME,
		version: packageVersion,
	};
}

export function validateByzTarballManifest(manifest, plan) {
	if (manifest?.name !== plan.packageName || manifest?.version !== plan.version) {
		throw new Error("BYZ tarball identity does not match the validated release plan.");
	}
}

function runGit(args) {
	return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function validateByzPublishState({
	githubActions,
	githubRefName,
	head,
	mainContainsHead,
	tag,
	tagCommit,
	worktreeClean,
}) {
	if (!githubActions || githubRefName !== tag) {
		throw new Error("BYZ publish is allowed only in GitHub Actions for the matching release tag.");
	}
	if (!worktreeClean) throw new Error("BYZ publish requires a clean worktree.");
	if (tagCommit !== head) throw new Error(`BYZ release tag ${tag} does not point to HEAD.`);
	if (!mainContainsHead) throw new Error("BYZ publish requires the tagged commit to be contained in origin/main.");
}

function assertPublishGitState(tag) {
	const head = runGit(["rev-parse", "HEAD"]);
	let mainContainsHead = true;
	try {
		execFileSync("git", ["merge-base", "--is-ancestor", head, "origin/main"], {
			cwd: repositoryRoot,
			stdio: "ignore",
		});
	} catch {
		mainContainsHead = false;
	}
	validateByzPublishState({
		githubActions: process.env.GITHUB_ACTIONS === "true",
		githubRefName: process.env.GITHUB_REF_NAME,
		head,
		mainContainsHead,
		tag,
		tagCommit: runGit(["rev-list", "-n", "1", tag]),
		worktreeClean: !runGit(["status", "--porcelain"]),
	});
}

async function getPublishedVersions(fetchRegistry = globalThis.fetch) {
	const response = await fetchRegistry("https://registry.npmjs.org/@aibyzero%2fbyz", {
		headers: { accept: "application/json" },
		redirect: "error",
		signal: AbortSignal.timeout(10_000),
	});
	if (response.status === 404) return [];
	if (!response.ok) throw new Error(`Could not read BYZ package metadata (HTTP ${response.status}).`);
	const data = await response.json();
	if (data?.name !== BYZ_PACKAGE_NAME || typeof data.versions !== "object" || data.versions === null) {
		throw new Error("The npm registry returned invalid BYZ package metadata.");
	}
	return Object.keys(data.versions);
}

function parseArguments(args) {
	let expectedGenerationIdentity;
	let expectedSha256;
	let packDestination;
	let receiptPath;
	let tag;
	let publishTarball;
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === "--tag") {
			tag = args[++index];
			if (!tag) throw new Error("--tag requires a value.");
		} else if (argument === "--publish") {
			publishTarball = args[++index];
			if (!publishTarball || publishTarball.startsWith("--")) throw new Error("--publish requires a tarball path.");
		} else if (argument === "--receipt") {
			receiptPath = args[++index];
			if (!receiptPath || receiptPath.startsWith("--")) throw new Error("--receipt requires a path.");
		} else if (argument === "--pack-destination") {
			packDestination = args[++index];
			if (!packDestination || packDestination.startsWith("--")) {
				throw new Error("--pack-destination requires a trusted base directory.");
			}
		} else if (argument === "--expected-generation") {
			expectedGenerationIdentity = args[++index];
			if (!/^generations\/[^/]+\/package$/.test(expectedGenerationIdentity ?? "")) {
				throw new Error("--expected-generation requires a valid generation identity.");
			}
		} else if (argument === "--expected-sha256") {
			expectedSha256 = args[++index];
			if (!/^[0-9a-f]{64}$/.test(expectedSha256 ?? "")) {
				throw new Error("--expected-sha256 requires a lowercase SHA-256 digest.");
			}
		} else if (argument === "--help" || argument === "-h") {
			return { help: true };
		} else {
			throw new Error(`Unknown BYZ release argument: ${argument}`);
		}
	}
	if (!tag) throw new Error("--tag is required.");
	if ((publishTarball && !receiptPath) || (!publishTarball && receiptPath)) {
		throw new Error("--publish and --receipt must be provided together.");
	}
	if (publishTarball && packDestination) throw new Error("--pack-destination is valid only for release dry-run.");
	if (publishTarball && (!expectedGenerationIdentity || !expectedSha256)) {
		throw new Error("Publish requires --expected-generation and --expected-sha256 from release dry-run.");
	}
	if (!publishTarball && (expectedGenerationIdentity || expectedSha256)) {
		throw new Error("Expected artifact identity is valid only with --publish.");
	}
	return {
		expectedGenerationIdentity,
		expectedSha256,
		help: false,
		packDestination,
		publishTarball,
		receiptPath,
		tag,
	};
}

export async function publishValidatedByzArtifact({
	currentImage,
	expectedGenerationIdentity,
	expectedSha256,
	packageDir: sourcePackageDir,
	plan,
	publish,
	publishLock,
	receiptPath,
	tarballPath,
}) {
	if (!/^generations\/[^/]+\/package$/.test(expectedGenerationIdentity ?? "") || !/^[0-9a-f]{64}$/.test(expectedSha256 ?? "")) {
		throw new Error("Publishing requires the expected release dry-run artifact identity.");
	}
	const verified = await verifyArtifact({ expectedGenerationIdentity, expectedSha256, receiptPath, tarballPath });
	try {
		validateByzTarballManifest(verified.receipt.package, plan);
		const receiptImage = await validateReceiptAgainstCurrentImage(sourcePackageDir, verified.receipt);
		if (receiptImage.imageDir !== currentImage.imageDir) {
			throw new Error("BYZ current package image changed during artifact validation.");
		}
		await publishLock.assertOwner();
		await publish(verified.captured.snapshotPath);
		await publishLock.assertOwner();
	} finally {
		await verified.captured.release();
	}
}

export async function createByzDryRunArtifact({
	args = [],
	onArtifactPacked,
	packageDir: sourcePackageDir = packageDir,
} = {}) {
	const outputDir = resolve(sourcePackageDir, ".byz-output");
	const releaseLock = await acquireBuildLock(outputDir, { packageDir: sourcePackageDir });
	let artifact;
	let failure;
	let result;
	try {
		await releaseLock.assertOwner();
		const initialImage = await validateCurrentByzImage({ packageDir: sourcePackageDir });
		artifact = await packCurrentByzImage({ args, packageDir: sourcePackageDir });
		if (artifact.imageDir !== initialImage.imageDir) {
			throw new Error("BYZ current package image changed while creating the release artifact.");
		}
		await onArtifactPacked?.(artifact);
		await releaseLock.assertOwner();
		const verified = await verifyArtifact({ receiptPath: artifact.receiptPath, tarballPath: artifact.artifactPath });
		try {
			const receiptImage = await validateReceiptAgainstCurrentImage(sourcePackageDir, verified.receipt);
			if (receiptImage.imageDir !== initialImage.imageDir) {
				throw new Error("BYZ current package image changed during release dry-run.");
			}
			await releaseLock.assertOwner();
			if ((await validateCurrentByzImage({ packageDir: sourcePackageDir })).imageDir !== initialImage.imageDir) {
				throw new Error("BYZ current package image changed before release dry-run completed.");
			}
			await releaseLock.assertOwner();
			const releaseArtifact = {
				artifactPath: artifact.artifactPath,
				generationIdentity: verified.receipt.generationIdentity,
				receiptPath: artifact.receiptPath,
				sha256: verified.sha256,
			};
			result = { ...artifact, ...releaseArtifact, output: `${JSON.stringify(releaseArtifact)}\n` };
		} finally {
			await verified.captured.release();
		}
	} catch (error) {
		failure = error;
	}
	try {
		await releasePublishLock(releaseLock);
	} catch (error) {
		failure ??= error;
	}
	if (failure) {
		if (artifact) await rm(dirname(artifact.artifactPath), { force: true, recursive: true });
		throw failure;
	}
	return result;
}

export async function releasePublishLock(publishLock) {
	if (!(await publishLock())) throw new Error("BYZ publish lock ownership was lost before release.");
}

async function main() {
	const options = parseArguments(process.argv.slice(2));
	if (options.help) {
		console.log(
			"Usage: node scripts/byz-release.mjs --tag byz-v<version> [--pack-destination <base> | --publish <tarball.tgz> --receipt <receipt.json> --expected-generation <id> --expected-sha256 <digest>]",
		);
		console.log("Without --publish, validates and dry-runs the single BYZ npm package.");
		return;
	}
	const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
	if (packageJson.name !== BYZ_PACKAGE_NAME || valid(packageJson.version) !== packageJson.version) {
		throw new Error("packages/byz/package.json has an invalid public package identity or version.");
	}
	const plan = createByzReleasePlan({
		packageVersion: packageJson.version,
		publishedVersions: await getPublishedVersions(),
		tag: options.tag,
	});
	if (options.publishTarball) {
		console.log(JSON.stringify(plan));
		assertPublishGitState(options.tag);
		const publishLock = await acquireBuildLock(resolve(packageDir, ".byz-output"), { packageDir });
		try {
			const currentImage = await validateCurrentByzImage({ packageDir });
			validateByzTarballManifest(currentImage.packageJson, plan);
			const tarballPath = resolve(repositoryRoot, options.publishTarball);
			const receiptPath = resolve(repositoryRoot, options.receiptPath);
			if (!tarballPath.endsWith(".tgz")) throw new Error("BYZ publish input must be a .tgz file.");
			if ((await validateCurrentByzImage({ packageDir })).imageDir !== currentImage.imageDir) {
				throw new Error("BYZ current package image changed before publication.");
			}
			await publishValidatedByzArtifact({
				currentImage,
				expectedGenerationIdentity: options.expectedGenerationIdentity,
				expectedSha256: options.expectedSha256,
				packageDir,
				plan,
				publish(snapshotPath) {
					execFileSync(
						"npm",
						["publish", snapshotPath, "--access", "public", "--provenance", "--ignore-scripts"],
						{
							cwd: repositoryRoot,
							stdio: "inherit",
						},
					);
				},
				publishLock,
				receiptPath,
				tarballPath,
			});
			return;
		} finally {
			await releasePublishLock(publishLock);
		}
	}
	const args = options.packDestination ? ["--pack-destination", options.packDestination] : [];
	const dryRun = await createByzDryRunArtifact({ args });
	process.stdout.write(dryRun.output);
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
