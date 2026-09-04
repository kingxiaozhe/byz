import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDeliveryActionRunner } from "../src/delivery/action-runner.js";
import {
	createDeliveryProcessRunner,
	createGitSnapshot,
	parsePorcelainZ,
	sanitizeOrigin,
} from "../src/delivery/git-snapshot.js";
import { checkGitHubCli, readGitHubPr } from "../src/delivery/github-pr.js";
import { createDeliveryIntentStore } from "../src/delivery/intent.js";
import { projectDeliveryReadiness } from "../src/delivery/readiness.js";
import { createDeliveryScopeTracker } from "../src/delivery/scope.js";

function git(cwd, args) {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.trim();
}

const registrySnapshot = Object.freeze({
	availability: "available",
	generation: 7,
	plan: Object.freeze({
		id: "plan-1",
		state: "terminal",
		total: 1,
		counts: Object.freeze({
			completed: 1,
			blocked: 0,
			cancelled: 0,
			declaredEvidence: 1,
			observedEvidence: 0,
			verifiedEvidence: 2,
			verifiedPassedEvidence: 5,
			verifiedFailedEvidence: 0,
			verifiedPassedCategories: Object.freeze(["build", "check", "qa", "review", "test"]),
		}),
		active: Object.freeze({ id: "task-1", ordinal: 1 }),
	}),
});

test("porcelain and origin parsers are closed and credential-safe", () => {
	assert.deepEqual(parsePorcelainZ(" M src/a.js\0?? other.txt\0"), [
		{
			conflict: false,
			indexState: " ",
			path: "src/a.js",
			renamed: false,
			sourcePath: undefined,
			untracked: false,
			worktreeState: "M",
		},
		{
			conflict: false,
			indexState: "?",
			path: "other.txt",
			renamed: false,
			sourcePath: undefined,
			untracked: true,
			worktreeState: "?",
		},
	]);
	assert.deepEqual(sanitizeOrigin("https://github.com/acme/project.git"), {
		host: "github",
		repository: "acme/project",
	});
	assert.deepEqual(sanitizeOrigin("git@github.com:acme/project.git"), { host: "github", repository: "acme/project" });
	assert.equal(sanitizeOrigin("https://token@github.com/acme/project.git?secret=1"), undefined);
	assert.equal(sanitizeOrigin("https://github.com/acme/project.git?credential=secret"), undefined);
	assert.throws(() => parsePorcelainZ("bad"), /invalid/);
});

test("scope commits only after receipt append and detects later digest drift", async () => {
	const root = await mkdtemp(join(tmpdir(), "byz-delivery-scope-"));
	try {
		await writeFile(join(root, "a.txt"), "one");
		const receipts = [];
		const tracker = createDeliveryScopeTracker({
			cwd: root,
			appendReceipt: async (receipt) => receipts.push(receipt),
			hasTask: () => true,
			readRegistrySnapshot: () => registrySnapshot,
		});
		assert.equal(
			await tracker.observe({
				outcome: "success",
				path: "a.txt",
				registrySnapshot,
				toolCallId: "call-1",
				toolName: "write",
			}),
			true,
		);
		assert.equal((await tracker.candidates())[0].current, true);
		await writeFile(join(root, "a.txt"), "two");
		assert.equal((await tracker.candidates())[0].current, false);
		const failed = createDeliveryScopeTracker({
			cwd: root,
			hasTask: () => true,
			readRegistrySnapshot: () => registrySnapshot,
			appendReceipt: async () => {
				throw new Error("append failed");
			},
		});
		await assert.rejects(
			failed.observe({
				outcome: "success",
				path: "a.txt",
				registrySnapshot,
				toolCallId: "call-2",
				toolName: "write",
			}),
			/append failed/,
		);
		assert.deepEqual(await failed.candidates(), []);
		assert.equal(tracker.replay([{ ...receipts[0], sequence: 2 }]), false);
		assert.equal(
			await tracker.observe({ outcome: "success", path: "a.txt", registrySnapshot, toolName: "write" }),
			false,
		);
		assert.equal(tracker.replay([{ ...receipts[0], generation: 999, sequence: 1 }]), true);
		assert.deepEqual(await tracker.candidates(), []);
		assert.equal(
			tracker.replay(Array.from({ length: 129 }, (_, index) => ({ ...receipts[0], sequence: index + 1 }))),
			false,
		);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("real temp Git snapshot intersects observed scope and excludes unrelated dirty files", async () => {
	const root = await mkdtemp(join(tmpdir(), "byz-delivery-git-"));
	try {
		git(root, ["init", "-b", "feature"]);
		git(root, ["config", "user.name", "Test"]);
		git(root, ["config", "user.email", "test@example.com"]);
		await Promise.all([writeFile(join(root, "a.txt"), "base"), writeFile(join(root, "c.txt"), "base")]);
		git(root, ["add", "a.txt", "c.txt"]);
		git(root, ["commit", "-m", "base"]);
		git(root, ["remote", "add", "origin", "https://github.com/acme/project.git"]);
		await writeFile(join(root, "a.txt"), "scoped");
		const receipts = [];
		const tracker = createDeliveryScopeTracker({
			cwd: root,
			appendReceipt: async (receipt) => receipts.push(receipt),
			hasTask: () => true,
			readRegistrySnapshot: () => registrySnapshot,
		});
		await tracker.observe({
			outcome: "success",
			path: "a.txt",
			registrySnapshot,
			toolCallId: "call-3",
			toolName: "edit",
		});
		await writeFile(join(root, "c.txt"), "other session");
		const processRunner = createDeliveryProcessRunner();
		const snapshot = await createGitSnapshot({
			cwd: root,
			registrySnapshot,
			runner: {
				run: (program, args, options) =>
					args[0] === "ls-remote"
						? Promise.resolve({ exitCode: 1, stdout: "", stderr: "", timedOut: false })
						: processRunner.run(program, args, options),
			},
			scopeTracker: tracker,
		});
		assert.deepEqual(snapshot.candidatePaths, ["a.txt"]);
		assert.equal(snapshot.excludedCount, 1);
		assert.equal(
			projectDeliveryReadiness({ gitSnapshot: snapshot, registrySnapshot, trusted: true }).commit,
			"ready",
		);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("real scoped commit leaves unrelated dirty work untouched and proves exact committed paths", async () => {
	const root = await mkdtemp(join(tmpdir(), "byz-delivery-commit-"));
	try {
		git(root, ["init", "-b", "feature"]);
		git(root, ["config", "user.name", "Test"]);
		git(root, ["config", "user.email", "test@example.com"]);
		await Promise.all([writeFile(join(root, "a.txt"), "base"), writeFile(join(root, "other.txt"), "base")]);
		git(root, ["add", "a.txt", "other.txt"]);
		git(root, ["commit", "-m", "base"]);
		const head = git(root, ["rev-parse", "HEAD"]);
		await Promise.all([writeFile(join(root, "a.txt"), "scoped"), writeFile(join(root, "other.txt"), "unrelated")]);
		const result = await createDeliveryActionRunner({ cwd: root, runner: createDeliveryProcessRunner() }).commit(
			{ action: "commit" },
			{ candidatePaths: ["a.txt"], head },
			"scoped commit",
		);
		assert.equal(result.outcome, "success");
		assert.deepEqual(git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).split("\n"), ["a.txt"]);
		assert.match(git(root, ["status", "--porcelain"]), /other\.txt/);
		const bare = join(root, "remote.git");
		git(root, ["init", "--bare", bare]);
		git(root, ["remote", "add", "origin", bare]);
		const pushed = await createDeliveryActionRunner({ cwd: root, runner: createDeliveryProcessRunner() }).push(
			{ action: "push" },
			{ branch: "feature", head: result.commitSha, upstream: "origin/feature" },
		);
		assert.equal(pushed.outcome, "success");
		assert.equal(git(root, ["--git-dir", bare, "rev-parse", "refs/heads/feature"]), result.commitSha);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("readiness requires passed verified evidence and never enables merge without the full boundary", () => {
	const gitSnapshot = {
		branch: "feature",
		candidatePaths: ["a.txt"],
		conflictCount: 0,
		detached: false,
		excludedCount: 0,
		head: "a".repeat(40),
		origin: { host: "github", repository: "acme/project" },
		remoteBranchOid: "a".repeat(40),
		status: [{ indexState: " ", worktreeState: "M", untracked: false }],
		upstream: "origin/feature",
	};
	const noEvidence = { availability: "available", plan: { state: "terminal", counts: {} } };
	assert.equal(
		projectDeliveryReadiness({ gitSnapshot, registrySnapshot: noEvidence, trusted: true }).commit,
		"blocked",
	);
	const unrelatedVerified = {
		availability: "available",
		plan: {
			state: "terminal",
			total: 1,
			counts: { completed: 1, verifiedPassedEvidence: 1, verifiedPassedCategories: ["test"] },
		},
	};
	assert.equal(
		projectDeliveryReadiness({ gitSnapshot, registrySnapshot: unrelatedVerified, trusted: true }).commit,
		"blocked",
	);
	const failed = {
		availability: "available",
		plan: { state: "terminal", counts: { verifiedPassedEvidence: 1, verifiedFailedEvidence: 1 } },
	};
	assert.equal(
		projectDeliveryReadiness({ gitSnapshot, registrySnapshot: failed, trusted: true }).verification,
		"failed",
	);
	assert.equal(
		projectDeliveryReadiness({
			gitSnapshot: { ...gitSnapshot, candidatePaths: [], status: [] },
			registrySnapshot: { availability: "empty" },
			trusted: true,
			pr: { base: "main", baseSha: "b".repeat(40), checks: "success", headSha: gitSnapshot.head, mergeable: true },
		}).merge,
		"blocked",
	);
	assert.equal(
		projectDeliveryReadiness({
			gitSnapshot: { ...gitSnapshot, status: [{ indexState: "?", worktreeState: "?", untracked: true }] },
			registrySnapshot,
			trusted: true,
		}).commit,
		"blocked",
	);
});

test("one-time intents expire, bind action/fingerprint, and cannot cross actions", () => {
	let now = 0;
	const store = createDeliveryIntentStore({ now: () => now, ttlMs: 10 });
	const snapshot = { fingerprint: "a".repeat(64) };
	const intent = store.create("commit", snapshot, { paths: ["a"] });
	assert.equal(store.consume(intent.intentId, "push", snapshot), undefined);
	const next = store.create("commit", snapshot, { paths: ["a"] });
	now = 11;
	assert.equal(store.consume(next.intentId, "commit", snapshot), undefined);
	const current = store.create("commit", snapshot, { paths: ["a"] });
	assert.equal(store.consume(current.intentId, "commit", { fingerprint: "b".repeat(64) }), undefined);
});

test("controlled runner uses fixed argv and reports partial remote outcomes", async () => {
	const calls = [];
	const base = "0".repeat(40);
	const commit = "a".repeat(40);
	const blob = "1".repeat(40);
	let committed = false;
	const runner = {
		async run(program, args) {
			calls.push({ program, args });
			const key = args.join(" ");
			if (key === "hash-object -- a.txt" || key === "rev-parse :a.txt" || key === `rev-parse ${commit}:a.txt`) {
				return { exitCode: 0, stdout: `${blob}\n`, stderr: "", timedOut: false };
			}
			if (key === "add -- a.txt") return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
			if (key === "diff --cached --name-only -z" || key.startsWith("diff-tree ")) {
				return { exitCode: 0, stdout: "a.txt\0", stderr: "", timedOut: false };
			}
			if (key === "rev-parse HEAD")
				return { exitCode: 0, stdout: `${committed ? commit : base}\n`, stderr: "", timedOut: false };
			if (key === `rev-parse ${commit}^`) return { exitCode: 0, stdout: `${base}\n`, stderr: "", timedOut: false };
			if (key.startsWith("commit --only")) {
				committed = true;
				return { exitCode: 0, stdout: "committed", stderr: "", timedOut: false };
			}
			return { exitCode: 1, stdout: "", stderr: "unsupported", timedOut: false };
		},
	};
	const actions = createDeliveryActionRunner({ cwd: "/workspace", runner });
	const result = await actions.commit({ action: "commit" }, { candidatePaths: ["a.txt"], head: base }, "safe message");
	assert.equal(result.outcome, "success");
	assert.ok(calls.some((call) => call.args.join(" ") === "add -- a.txt"));
	assert.ok(calls.every((call) => !call.args.includes("--force") && !call.args.includes("--no-verify")));
});

test("push, draft PR, and checks-gated merge use fixed non-force argv and observed results", async () => {
	const head = "c".repeat(40);
	const calls = [];
	const responses = [
		{ exitCode: 0, stdout: "", stderr: "", timedOut: false },
		{ exitCode: 0, stdout: `${head}\trefs/heads/feature\n`, stderr: "", timedOut: false },
		{ exitCode: 0, stdout: "https://github.com/acme/project/pull/7\n", stderr: "", timedOut: false },
		{
			exitCode: 0,
			stdout: JSON.stringify({ number: 7, isDraft: true, headRefOid: head, baseRefName: "main" }),
			stderr: "",
			timedOut: false,
		},
		{ exitCode: 0, stdout: "", stderr: "", timedOut: false },
		{
			exitCode: 0,
			stdout: JSON.stringify({ state: "MERGED", mergedAt: "2026-09-03T00:00:00Z" }),
			stderr: "",
			timedOut: false,
		},
	];
	const runner = {
		run: async (program, args) => {
			calls.push({ program, args });
			return responses.shift();
		},
	};
	const actions = createDeliveryActionRunner({ cwd: "/tmp/repo", runner });
	const snapshot = {
		branch: "feature",
		head,
		origin: { host: "github", repository: "acme/project" },
		upstream: "origin/feature",
	};
	assert.equal((await actions.push({ action: "push" }, snapshot)).outcome, "success");
	assert.equal(
		(await actions.createPr({ action: "pr" }, snapshot, { base: "main", bodyFile: "/tmp/body", title: "Title" }))
			.outcome,
		"success",
	);
	assert.equal(
		(
			await actions.merge({ action: "merge" }, snapshot, {
				number: 7,
				checks: "success",
				mergeable: true,
				headSha: head,
				repository: "acme/project",
			})
		).outcome,
		"success",
	);
	assert.deepEqual(calls[0], { program: "git", args: ["push", "origin", "feature:feature"] });
	assert.ok(calls.some((call) => call.program === "gh" && call.args.includes("--draft")));
	assert.ok(calls.some((call) => call.program === "gh" && call.args[0] === "pr" && call.args[1] === "merge"));
	assert.ok(calls.every((call) => !call.args.includes("--force") && !call.args.includes("--admin")));
	await assert.rejects(actions.push({ action: "push" }, { ...snapshot, upstream: "upstream/feature" }), /origin/);
});

test("draft PR observation rejects a URL from another repository", async () => {
	const head = "c".repeat(40);
	const responses = [
		{ exitCode: 0, stdout: "https://github.com/other/project/pull/7\n", stderr: "", timedOut: false },
		{
			exitCode: 0,
			stdout: JSON.stringify({ number: 7, isDraft: true, headRefOid: head, baseRefName: "main" }),
			stderr: "",
			timedOut: false,
		},
	];
	const result = await createDeliveryActionRunner({
		cwd: "/tmp/repo",
		runner: { run: async () => responses.shift() },
	}).createPr(
		{ action: "pr" },
		{ branch: "feature", head, origin: { host: "github", repository: "acme/project" } },
		{ base: "main", bodyFile: "/tmp/body", title: "Title" },
	);
	assert.equal(result.outcome, "partial");
});

test("failed push still observes remote state before reporting side effects", async () => {
	const head = "d".repeat(40);
	const calls = [];
	const runner = {
		run: async (_program, args) => {
			calls.push(args);
			return args[0] === "push"
				? { exitCode: 1, stdout: "", stderr: "lost response", timedOut: true }
				: { exitCode: 0, stdout: `${head}\trefs/heads/feature\n`, stderr: "", timedOut: false };
		},
	};
	const result = await createDeliveryActionRunner({ cwd: "/tmp/repo", runner }).push(
		{ action: "push" },
		{ branch: "feature", head, upstream: "origin/feature" },
	);
	assert.equal(calls.length, 2);
	assert.equal(result.outcome, "partial");
	assert.deepEqual(result.sideEffects, ["remote_branch_observed"]);
});

test("GitHub PR readiness proves every protected required check and app identity", async () => {
	const head = "a".repeat(40);
	const base = "b".repeat(40);
	function runner(checks, required = { contexts: ["test", "lint"], checks: [] }, checkRuns = []) {
		return {
			async run(_program, args) {
				if (args[0] === "auth") return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
				if (args[0] === "repo")
					return {
						exitCode: 0,
						stdout: JSON.stringify({ nameWithOwner: "acme/project" }),
						stderr: "",
						timedOut: false,
					};
				if (args[0] === "api")
					return {
						exitCode: 0,
						stdout: JSON.stringify(args[1].endsWith("/check-runs") ? { check_runs: checkRuns } : required),
						stderr: "",
						timedOut: false,
					};
				return {
					exitCode: 0,
					stdout: JSON.stringify({
						baseRefName: "main",
						baseRefOid: base,
						headRefOid: head,
						mergeable: "MERGEABLE",
						number: 7,
						state: "OPEN",
						statusCheckRollup: checks,
					}),
					stderr: "",
					timedOut: false,
				};
			},
		};
	}
	assert.equal(await checkGitHubCli({ cwd: "/tmp", runner: runner([]) }), true);
	assert.equal(
		(await readGitHubPr({ cwd: "/tmp", runner: runner([{ name: "test", conclusion: "SUCCESS" }]) })).checks,
		"blocked",
	);
	assert.equal(
		(
			await readGitHubPr({
				cwd: "/tmp",
				runner: runner([
					{ name: "test", conclusion: "SUCCESS" },
					{ name: "lint", conclusion: "SUCCESS" },
				]),
			})
		).checks,
		"success",
	);
	const appRequirement = { contexts: [], checks: [{ context: "test", app_id: 42 }] };
	assert.equal(
		(
			await readGitHubPr({
				cwd: "/tmp",
				runner: runner([], appRequirement, [{ name: "test", conclusion: "success", app: { id: 7 } }]),
			})
		).checks,
		"blocked",
	);
	const appBound = await readGitHubPr({
		cwd: "/tmp",
		runner: runner([], appRequirement, [{ name: "test", conclusion: "success", app: { id: 42 } }]),
	});
	assert.equal(appBound.checks, "success");
	assert.deepEqual(appBound.requiredChecks, [{ appId: 42, context: "test", outcome: "passed" }]);
});

test("release readiness remains informational", () => {
	const readiness = projectDeliveryReadiness({
		trusted: true,
		registrySnapshot,
		gitSnapshot: { candidatePaths: [], status: [], conflictCount: 0, detached: false },
	});
	assert.equal(readiness.release, "informational");
	assert.equal(readiness.verification, "verified");
});
