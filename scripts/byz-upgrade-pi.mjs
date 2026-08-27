#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STABLE_TAG = /^v\d+\.\d+\.\d+$/;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const ORIGIN_MAIN_REF = "refs/remotes/origin/main";
const UPSTREAM_MAIN_REF = "refs/remotes/upstream/main";
const UPSTREAM_TAG_NAMESPACE = "refs/byz-upstream/tags";
const UPSTREAM_METADATA_PATH = "packages/byz/upstream.json";

class UpgradeError extends Error {
	constructor(message, exitCode = 1) {
		super(message);
		this.exitCode = exitCode;
	}
}

function formatCommand(command, args) {
	return [command, ...args].join(" ");
}

function createCommandRunner(cwd) {
	return (command, args, options = {}) => {
		const result = spawnSync(command, args, {
			cwd,
			encoding: "utf8",
			env: options.env ? { ...process.env, ...options.env } : process.env,
			stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
		});
		if (result.error) throw result.error;
		const response = {
			status: result.status ?? 1,
			stdout: result.stdout?.trim() ?? "",
			stderr: result.stderr?.trim() ?? "",
		};
		if (response.status !== 0 && !options.allowFailure) {
			const detail = response.stderr || response.stdout || `exit ${response.status}`;
			throw new UpgradeError(`${formatCommand(command, args)} failed: ${detail}`);
		}
		return response;
	};
}

export function parseArgs(argv) {
	const options = { allowLockfileChange: false, apply: false, help: false, target: undefined };
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--apply") {
			options.apply = true;
		} else if (arg === "--allow-lockfile-change") {
			options.allowLockfileChange = true;
		} else if (arg === "--help" || arg === "-h") {
			options.help = true;
		} else if (arg === "--to") {
			options.target = argv[++index];
			if (!options.target) throw new UpgradeError("--to requires a Pi tag or full 40-character commit SHA.", 2);
		} else if (arg.startsWith("--to=")) {
			options.target = arg.slice("--to=".length);
			if (!options.target) throw new UpgradeError("--to requires a Pi tag or full 40-character commit SHA.", 2);
		} else {
			throw new UpgradeError(`Unknown option: ${arg}`, 2);
		}
	}
	if (options.apply && !options.target) {
		throw new UpgradeError("--apply requires an explicit --to <tag-or-full-sha> target.", 2);
	}
	if (options.allowLockfileChange && !options.apply) {
		throw new UpgradeError("--allow-lockfile-change is valid only with --apply.", 2);
	}
	return options;
}

export function canonicalRepositoryId(value, { allowFile = false } = {}) {
	const trimmed = value.trim().replace(/\/$/, "").replace(/\.git$/i, "");
	const scpMatch = trimmed.match(/^git@github\.com:([^/]+\/[^/]+)$/i);
	if (scpMatch) return `github.com/${scpMatch[1]}`.toLowerCase();
	try {
		const url = new URL(trimmed);
		if (allowFile && url.protocol === "file:") return `file:${url.pathname}`;
		const isSecureHttps =
			url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search && !url.hash;
		const isSecureSsh =
			url.protocol === "ssh:" && url.username === "git" && !url.password && !url.port && !url.search && !url.hash;
		const repositoryPath = url.pathname.replace(/^\//, "");
		if (
			url.hostname.toLowerCase() !== "github.com" ||
			(!isSecureHttps && !isSecureSsh) ||
			!/^[^/]+\/[^/]+$/.test(repositoryPath)
		) {
			throw new UpgradeError("The upstream remote must use GitHub HTTPS or SSH with an owner/repository path.");
		}
		return `github.com/${repositoryPath}`.toLowerCase();
	} catch {
		throw new UpgradeError("The upstream remote must use GitHub HTTPS or SSH with an owner/repository path.");
	}
}

export function shellQuote(value) {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function git(runner, args, options) {
	return runner("git", ["--no-replace-objects", ...args], options);
}

function gitOutput(runner, args) {
	return git(runner, args).stdout;
}

function isAncestor(runner, ancestor, descendant) {
	return git(runner, ["merge-base", "--is-ancestor", ancestor, descendant], { allowFailure: true }).status === 0;
}

function resolveCommit(runner, revision) {
	const result = git(runner, ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`], {
		allowFailure: true,
	});
	if (result.status !== 0 || !FULL_SHA.test(result.stdout)) {
		throw new UpgradeError(`Pi target does not resolve to a commit: ${revision}`);
	}
	return result.stdout.toLowerCase();
}

function resolveExplicitTarget(runner, target) {
	if (FULL_SHA.test(target)) {
		return { applyTarget: target.toLowerCase(), commit: resolveCommit(runner, target), label: target.slice(0, 12) };
	}
	if (target.startsWith("-") || git(runner, ["check-ref-format", `refs/tags/${target}`], { allowFailure: true }).status !== 0) {
		throw new UpgradeError("--to must be a valid Pi tag or full 40-character commit SHA.", 2);
	}
	return { applyTarget: target, commit: resolveCommit(runner, `${UPSTREAM_TAG_NAMESPACE}/${target}`), label: target };
}

function findLatestStableTarget(runner, baseline) {
	const tags = gitOutput(runner, [
		"for-each-ref",
		"--sort=-version:refname",
		"--format=%(refname:strip=3)",
		`${UPSTREAM_TAG_NAMESPACE}/v*`,
	])
		.split("\n")
		.filter((tag) => STABLE_TAG.test(tag));
	for (const tag of tags) {
		const commit = resolveCommit(runner, `${UPSTREAM_TAG_NAMESPACE}/${tag}`);
		if (commit !== baseline && isAncestor(runner, baseline, commit) && isAncestor(runner, commit, UPSTREAM_MAIN_REF)) {
			return { applyTarget: tag, commit, label: tag };
		}
	}
	return undefined;
}

function assertTargetRelation(runner, baseline, target) {
	if (target === baseline) return "current";
	if (isAncestor(runner, target, baseline)) {
		throw new UpgradeError(`Refusing to downgrade Pi from ${baseline.slice(0, 12)} to ${target.slice(0, 12)}.`);
	}
	if (!isAncestor(runner, baseline, target)) {
		throw new UpgradeError("The requested Pi target is unrelated to the recorded BYZ baseline.");
	}
	if (!isAncestor(runner, target, UPSTREAM_MAIN_REF)) {
		throw new UpgradeError("The requested target is not reachable from the official upstream/main history.");
	}
	return "upgrade";
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function readProtectedFiles(runner, root) {
	const files = new Map();
	for (const line of gitOutput(runner, ["ls-files", "--stage", "--", "packages/byz"]).split("\n")) {
		const separator = line.indexOf("\t");
		if (separator === -1) continue;
		const path = line.slice(separator + 1);
		if (path === UPSTREAM_METADATA_PATH) continue;
		const absolutePath = join(root, path);
		const stat = lstatSync(absolutePath);
		const kind = stat.isSymbolicLink() ? "symlink" : stat.isFile() ? "file" : "unsupported";
		const content = kind === "symlink" ? Buffer.from(readlinkSync(absolutePath)) : readFileSync(absolutePath);
		files.set(path, {
			content,
			executable: (stat.mode & 0o111) !== 0,
			indexEntry: line.slice(0, separator),
			kind,
		});
	}
	return files;
}

function assertProtectedFiles(runner, root, before) {
	let current;
	try {
		current = readProtectedFiles(runner, root);
	} catch {
		throw new UpgradeError("Protected BYZ files changed during the Pi merge or verification.");
	}
	if (JSON.stringify([...current.keys()]) !== JSON.stringify([...before.keys()])) {
		throw new UpgradeError("Protected BYZ files changed during the Pi merge or verification.");
	}
	for (const [path, expected] of before) {
		const actual = current.get(path);
		if (
			!actual ||
			actual.kind !== expected.kind ||
			actual.executable !== expected.executable ||
			actual.indexEntry !== expected.indexEntry ||
			!actual.content.equals(expected.content)
		) {
			throw new UpgradeError(`Protected BYZ file changed during the Pi merge: ${path}`);
		}
	}
}

function readUpstreamFileStructure(runner, root) {
	const lines = gitOutput(runner, ["ls-files", "--stage", "--", UPSTREAM_METADATA_PATH])
		.split("\n")
		.filter(Boolean);
	if (lines.length !== 1) return undefined;
	const separator = lines[0].indexOf("\t");
	if (separator === -1 || lines[0].slice(separator + 1) !== UPSTREAM_METADATA_PATH) return undefined;
	const [indexMode, , indexStage] = lines[0].slice(0, separator).split(" ");
	const absolutePath = join(root, UPSTREAM_METADATA_PATH);
	if (!existsSync(absolutePath)) return undefined;
	const stat = lstatSync(absolutePath);
	return {
		executable: (stat.mode & 0o111) !== 0,
		indexMode,
		indexStage,
		kind: stat.isFile() ? "file" : stat.isSymbolicLink() ? "symlink" : "unsupported",
	};
}

function assertUpstreamFileStructure(runner, root, expected) {
	const actual = readUpstreamFileStructure(runner, root);
	if (
		!actual ||
		actual.kind !== expected.kind ||
		actual.executable !== expected.executable ||
		actual.indexMode !== expected.indexMode ||
		actual.indexStage !== expected.indexStage
	) {
		throw new UpgradeError("packages/byz/upstream.json file structure changed; refusing to commit unsafe metadata.");
	}
}

function assertNoUntrackedFiles(runner) {
	const untracked = gitOutput(runner, ["ls-files", "--others", "--exclude-standard"]);
	if (untracked) throw new UpgradeError(`Verification left untracked files; review them before committing:\n${untracked}`);
}

function assertNoObjectOverrides(runner, root) {
	const replacementRefs = gitOutput(runner, ["for-each-ref", "--format=%(refname)", "refs/replace"]);
	if (replacementRefs) {
		throw new UpgradeError(`Remove local Git replacement refs before checking a Pi upgrade:\n${replacementRefs}`);
	}
	const graftsPath = resolveGitPath(runner, root, "info/grafts");
	if (existsSync(graftsPath) && readFileSync(graftsPath, "utf8").trim()) {
		throw new UpgradeError("Remove local Git grafts before checking a Pi upgrade.");
	}
}

function repositoryPatch(runner, base, cached = false) {
	return gitOutput(runner, [
		"diff",
		...(cached ? ["--cached"] : []),
		"--binary",
		"--full-index",
		"--no-ext-diff",
		"--no-textconv",
		base,
		"--",
	]);
}

function assertRepositoryPatch(runner, base, expected) {
	if (repositoryPatch(runner, base) !== expected) {
		throw new UpgradeError("Repository files changed during verification; refusing to commit unreviewed side effects.");
	}
}

function resolveGitPath(runner, root, name) {
	const gitPath = gitOutput(runner, ["rev-parse", "--git-path", name]);
	return isAbsolute(gitPath) ? gitPath : resolve(root, gitPath);
}

function assertMergeState(runner, root, target) {
	const mergeHeadPath = resolveGitPath(runner, root, "MERGE_HEAD");
	const mergeHead = existsSync(mergeHeadPath) ? readFileSync(mergeHeadPath, "utf8").trim().toLowerCase() : undefined;
	if (mergeHead !== target) {
		throw new UpgradeError("Git does not have the required Pi merge state; refusing to create a single-parent upgrade commit.");
	}
}

function runCommitHooks(runner, root, message, env) {
	git(runner, ["hook", "run", "--ignore-missing", "pre-commit"], { env, inherit: true });
	const messagePath = resolveGitPath(runner, root, "BYZ_UPGRADE_COMMIT_MSG");
	writeFileSync(messagePath, `${message}\n`);
	try {
		git(runner, ["hook", "run", "--ignore-missing", "prepare-commit-msg", "--", messagePath, "message"], {
			env,
			inherit: true,
		});
		git(runner, ["hook", "run", "--ignore-missing", "commit-msg", "--", messagePath], { env, inherit: true });
		return readFileSync(messagePath, "utf8").trim();
	} finally {
		rmSync(messagePath, { force: true });
	}
}

function assertUpstreamMetadata(actual, expected) {
	const keys = Object.keys(actual).sort();
	const expectedKeys = Object.keys(expected).sort();
	if (
		JSON.stringify(keys) !== JSON.stringify(expectedKeys) ||
		keys.some((key) => actual[key] !== expected[key])
	) {
		throw new UpgradeError("packages/byz/upstream.json changed during verification; refusing to commit incorrect Pi facts.");
	}
}

function assertCommittedUpstream(runner, commit, expectedStructure, expectedMetadata) {
	const entry = gitOutput(runner, ["ls-tree", commit, "--", UPSTREAM_METADATA_PATH]);
	const separator = entry.indexOf("\t");
	const [mode, type] = separator === -1 ? [] : entry.slice(0, separator).split(" ");
	if (
		separator === -1 ||
		entry.slice(separator + 1) !== UPSTREAM_METADATA_PATH ||
		mode !== expectedStructure.indexMode ||
		type !== "blob"
	) {
		throw new UpgradeError("The Pi upgrade commit contains an unsafe packages/byz/upstream.json structure.");
	}
	assertUpstreamMetadata(
		JSON.parse(gitOutput(runner, ["show", `${commit}:${UPSTREAM_METADATA_PATH}`])),
		expectedMetadata,
	);
}

function branchLabel(label) {
	const normalized = label.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	if (!normalized) throw new UpgradeError(`Cannot derive an upgrade branch from target label: ${label}`);
	return `upgrade/pi-${normalized}`;
}

function hasDependencyMetadataChanges(runner, baseline, target) {
	return gitOutput(runner, ["diff", "--name-only", `${baseline}..${target}`])
		.split("\n")
		.some((path) => /(^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json)$/.test(path));
}

function printHelp(write) {
	write("Usage: npm run byz:upgrade-pi -- [--to <tag-or-full-sha>] [--apply]");
	write("");
	write("Without --apply, the command only fetches and reports the upgrade plan.");
	write("--apply requires an explicit --to target and creates a local upgrade branch and merge commit.");
	write("--allow-lockfile-change explicitly authorizes dependency lock changes required by the selected Pi target.");
}

export function runUpgrade({
	argv = [],
	cwd = process.cwd(),
	now = () => new Date(),
	runner: injectedRunner,
	verificationRunner: injectedVerificationRunner,
	allowFileRemotes = false,
	write = console.log,
} = {}) {
	const options = parseArgs(argv);
	if (options.help) {
		printHelp(write);
		return { status: "help" };
	}

	const initialRunner = injectedRunner ?? createCommandRunner(cwd);
	const root = resolve(gitOutput(initialRunner, ["rev-parse", "--show-toplevel"]));
	const runner = injectedRunner ?? createCommandRunner(root);
	const verificationRunner = injectedVerificationRunner ?? runner;
	const upstreamPath = join(root, UPSTREAM_METADATA_PATH);
	const upstream = readJson(upstreamPath);
	const upstreamFileStructure = readUpstreamFileStructure(runner, root);
	if (
		!upstreamFileStructure ||
		upstreamFileStructure.kind !== "file" ||
		upstreamFileStructure.executable ||
		upstreamFileStructure.indexMode !== "100644" ||
		upstreamFileStructure.indexStage !== "0"
	) {
		throw new UpgradeError("packages/byz/upstream.json must be a tracked, non-executable regular file.");
	}
	const baseline = String(upstream.commit).toLowerCase();
	if (!FULL_SHA.test(baseline)) throw new UpgradeError("packages/byz/upstream.json contains an invalid Pi commit.");

	const branch = gitOutput(runner, ["branch", "--show-current"]);
	if (branch !== "main") throw new UpgradeError(`Run this command from main, not ${branch || "detached HEAD"}.`);
	if (gitOutput(runner, ["status", "--porcelain", "--untracked-files=all"])) {
		throw new UpgradeError("The working tree must be clean before checking a Pi upgrade.");
	}
	assertNoObjectOverrides(runner, root);

	const upstreamUrl = git(runner, ["remote", "get-url", "upstream"], { allowFailure: true });
	if (upstreamUrl.status !== 0) throw new UpgradeError("Missing required Git remote: upstream.");
	if (
		canonicalRepositoryId(upstreamUrl.stdout, { allowFile: allowFileRemotes }) !==
		canonicalRepositoryId(upstream.repository, { allowFile: allowFileRemotes })
	) {
		throw new UpgradeError(`Git remote upstream does not match ${upstream.repository}.`);
	}

	git(runner, ["fetch", "origin", "--no-tags", "--prune", `+refs/heads/main:${ORIGIN_MAIN_REF}`], { inherit: true });
	git(
		runner,
		[
			"fetch",
			"upstream",
			"--no-tags",
			"--prune",
			`+refs/heads/main:${UPSTREAM_MAIN_REF}`,
			`+refs/tags/*:${UPSTREAM_TAG_NAMESPACE}/*`,
		],
		{ inherit: true },
	);
	const head = gitOutput(runner, ["rev-parse", "refs/heads/main"]);
	const originMain = gitOutput(runner, ["rev-parse", ORIGIN_MAIN_REF]);
	if (head !== originMain) throw new UpgradeError("Local main must exactly match origin/main before checking a Pi upgrade.");
	resolveCommit(runner, baseline);
	if (!isAncestor(runner, baseline, head)) {
		throw new UpgradeError("The recorded Pi baseline is not an ancestor of BYZ main.");
	}
	if (!isAncestor(runner, baseline, UPSTREAM_MAIN_REF)) {
		throw new UpgradeError("The recorded Pi baseline is not part of the official upstream/main history.");
	}

	const target = options.target ? resolveExplicitTarget(runner, options.target) : findLatestStableTarget(runner, baseline);
	if (!target) {
		write(`BYZ already includes a Pi baseline newer than or equal to every stable upstream tag (${baseline.slice(0, 12)}).`);
		return { baseline, status: "no-update" };
	}
	const relation = assertTargetRelation(runner, baseline, target.commit);
	if (relation === "current") {
		write(`BYZ already records Pi ${target.label} (${target.commit.slice(0, 12)}).`);
		return { baseline, status: "current", target };
	}
	if (isAncestor(runner, target.commit, head)) {
		if (options.apply) {
			throw new UpgradeError(
				`Pi ${target.label} is already contained in BYZ main, but upstream.json still records ${baseline.slice(0, 12)}. Reconcile the metadata manually instead of creating a false merge commit.`,
			);
		}
		write(`Pi ${target.label} is already contained in BYZ main, but upstream.json is stale. Reconcile the metadata manually.`);
		return { baseline, status: "already-integrated", target };
	}
	const dependencyMetadataChanged = hasDependencyMetadataChanges(runner, baseline, target.commit);

	if (!options.apply) {
		write(`Pi upgrade available: ${baseline.slice(0, 12)} -> ${target.label} (${target.commit.slice(0, 12)}).`);
		const lockfileOption = dependencyMetadataChanged ? " --allow-lockfile-change" : "";
		write(
			`Apply explicitly with: npm run byz:upgrade-pi -- --to ${shellQuote(target.applyTarget)} --apply${lockfileOption}`,
		);
		return { baseline, status: "available", target };
	}
	if (dependencyMetadataChanged && !options.allowLockfileChange) {
		throw new UpgradeError(
			"The selected Pi target changes dependency metadata. Review the target, then re-run with --allow-lockfile-change to authorize the resulting lockfile update.",
		);
	}

	const upgradeBranch = branchLabel(target.label);
	if (
		git(runner, ["show-ref", "--verify", "--quiet", `refs/heads/${upgradeBranch}`], { allowFailure: true }).status === 0 ||
		git(runner, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${upgradeBranch}`], { allowFailure: true }).status === 0
	) {
		throw new UpgradeError(`Upgrade branch already exists: ${upgradeBranch}`);
	}

	const protectedFiles = readProtectedFiles(runner, root);
	git(runner, ["switch", "-c", upgradeBranch], { inherit: true });
	const merge = git(runner, ["merge", "--no-ff", "--no-commit", target.commit], { allowFailure: true, inherit: true });
	if (merge.status !== 0) {
		const conflicts = gitOutput(runner, ["diff", "--name-only", "--diff-filter=U"]);
		if (conflicts) {
			throw new UpgradeError(
				`Pi merge has conflicts on ${upgradeBranch}:\n${conflicts}\nResolve them manually, or run git merge --abort. No baseline metadata was updated.`,
			);
		}
		throw new UpgradeError(`Pi merge failed on ${upgradeBranch}. Inspect the repository before continuing.`);
	}
	assertMergeState(runner, root, target.commit);

	assertProtectedFiles(runner, root, protectedFiles);
	assertUpstreamFileStructure(runner, root, upstreamFileStructure);
	const targetPackage = JSON.parse(gitOutput(runner, ["show", `${target.commit}:packages/coding-agent/package.json`]));
	if (typeof targetPackage.version !== "string" || !targetPackage.version) {
		throw new UpgradeError("The target Pi commit has no coding-agent package version.");
	}
	const expectedUpstream = {
		repository: upstream.repository,
		commit: target.commit,
		codingAgentVersion: targetPackage.version,
		checkedAt: now().toISOString().slice(0, 10),
	};
	writeFileSync(upstreamPath, `${JSON.stringify(expectedUpstream, null, "\t")}\n`);
	assertUpstreamFileStructure(runner, root, upstreamFileStructure);

	if (dependencyMetadataChanged) {
		verificationRunner("npm", ["install", "--ignore-scripts"], { inherit: true });
	}
	assertUpstreamFileStructure(runner, root, upstreamFileStructure);
	const expectedPatch = repositoryPatch(runner, head);
	verificationRunner("npm", ["run", "build:byz"], { inherit: true });
	verificationRunner("npm", ["run", "check"], { inherit: true });
	verificationRunner("npm", ["--prefix", "packages/byz", "test"], { inherit: true });
	assertProtectedFiles(runner, root, protectedFiles);
	assertUpstreamFileStructure(runner, root, upstreamFileStructure);
	assertMergeState(runner, root, target.commit);
	assertUpstreamMetadata(readJson(upstreamPath), expectedUpstream);
	assertRepositoryPatch(runner, head, expectedPatch);

	assertNoUntrackedFiles(runner);
	const changedPaths = gitOutput(runner, ["diff", "--name-only", head, "--"])
		.split("\n")
		.filter(Boolean);
	git(runner, ["add", "--update", "--", ...changedPaths]);
	git(runner, ["diff", "--cached", "--check"]);
	if (repositoryPatch(runner, head, true) !== expectedPatch) {
		throw new UpgradeError("The staged Pi upgrade does not match the verified repository patch.");
	}
	const commitEnv = dependencyMetadataChanged ? { PI_ALLOW_LOCKFILE_CHANGE: "1" } : undefined;
	const commitMessage = runCommitHooks(runner, root, `feat: upgrade Pi base to ${target.label}`, commitEnv);
	assertProtectedFiles(runner, root, protectedFiles);
	assertUpstreamFileStructure(runner, root, upstreamFileStructure);
	assertMergeState(runner, root, target.commit);
	assertUpstreamMetadata(readJson(upstreamPath), expectedUpstream);
	assertRepositoryPatch(runner, head, expectedPatch);
	assertNoUntrackedFiles(runner);
	if (
		git(runner, ["diff", "--quiet", "--"], { allowFailure: true }).status !== 0 ||
		repositoryPatch(runner, head, true) !== expectedPatch
	) {
		throw new UpgradeError("Commit hooks changed or unstaged the verified Pi upgrade patch.");
	}
	const upgradeBranchRef = `refs/heads/${upgradeBranch}`;
	const tree = gitOutput(runner, ["write-tree"]);
	const upgradeCommit = gitOutput(runner, [
		"commit-tree",
		tree,
		"-p",
		head,
		"-p",
		target.commit,
		"-m",
		commitMessage,
	]);
	if (!FULL_SHA.test(upgradeCommit)) throw new UpgradeError("Git did not create a valid Pi upgrade commit object.");
	const commitLine = gitOutput(runner, ["rev-list", "--parents", "-n", "1", upgradeCommit]).split(" ");
	if (commitLine.length !== 3 || commitLine[1] !== head || commitLine[2] !== target.commit) {
		throw new UpgradeError("The created Pi upgrade commit does not have the expected BYZ and Pi parents.");
	}
	assertCommittedUpstream(runner, upgradeCommit, upstreamFileStructure, expectedUpstream);
	git(runner, ["merge", "--quit"]);
	git(runner, ["update-ref", upgradeBranchRef, upgradeCommit, head]);
	write(`Created verified Pi upgrade commit on ${upgradeBranch}.`);
	write("Push and open a PR only after reviewing the merge. Merge that PR with a merge commit, not squash.");
	return { baseline, branch: upgradeBranch, status: "applied", target };
}

export function main(argv = process.argv.slice(2)) {
	try {
		runUpgrade({ argv });
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = error instanceof UpgradeError ? error.exitCode : 1;
	}
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedFile === resolve(dirname(currentFile), "byz-upgrade-pi.mjs")) main();
