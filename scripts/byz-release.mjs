#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { valid } from "semver";

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
		} else if (argument === "--help" || argument === "-h") {
			return { help: true };
		} else {
			throw new Error(`Unknown BYZ release argument: ${argument}`);
		}
	}
	if (!tag) throw new Error("--tag is required.");
	return { help: false, publishTarball, tag };
}

async function main() {
	const options = parseArguments(process.argv.slice(2));
	if (options.help) {
		console.log("Usage: node scripts/byz-release.mjs --tag byz-v<version> [--publish <tarball.tgz>]");
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
	console.log(JSON.stringify(plan));
	if (options.publishTarball) {
		assertPublishGitState(options.tag);
		const tarballPath = resolve(repositoryRoot, options.publishTarball);
		if (!tarballPath.endsWith(".tgz") || !(await stat(tarballPath)).isFile()) {
			throw new Error("BYZ publish input must be an existing .tgz file.");
		}
		const manifest = JSON.parse(
			execFileSync("tar", ["-xOf", tarballPath, "package/package.json"], { encoding: "utf8" }),
		);
		validateByzTarballManifest(manifest, plan);
		execFileSync("npm", ["publish", tarballPath, "--access", "public", "--provenance", "--ignore-scripts"], {
			cwd: repositoryRoot,
			stdio: "inherit",
		});
		return;
	}
	execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
		cwd: packageDir,
		stdio: "inherit",
	});
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
