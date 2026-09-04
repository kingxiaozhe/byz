import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDeliveryExtension } from "../src/delivery/delivery-extension.js";
import { createDeliveryProcessRunner } from "../src/delivery/git-snapshot.js";

const BASE_HEAD = "a".repeat(40);
const COMMIT_HEAD = "b".repeat(40);

function git(cwd, args) {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.trim();
}

function createRunner(cwd) {
	const calls = [];
	let head = BASE_HEAD;
	let staged = false;
	return {
		calls,
		setHead(value) {
			head = value;
		},
		async run(program, args) {
			calls.push({ program, args });
			const key = `${program} ${args.join(" ")}`;
			if (key === "git rev-parse --show-toplevel")
				return { exitCode: 0, stdout: `${cwd}\n`, stderr: "", timedOut: false };
			if (key === "git rev-parse HEAD") return { exitCode: 0, stdout: `${head}\n`, stderr: "", timedOut: false };
			if (key === "git symbolic-ref --quiet --short HEAD")
				return { exitCode: 0, stdout: "feature\n", stderr: "", timedOut: false };
			if (key.startsWith("git status "))
				return { exitCode: 0, stdout: staged ? "M  a.txt\0" : " M a.txt\0", stderr: "", timedOut: false };
			if (key.includes("@{upstream}")) return { exitCode: 1, stdout: "", stderr: "", timedOut: false };
			if (key === "git remote get-url origin")
				return { exitCode: 0, stdout: "https://github.com/acme/project.git\n", stderr: "", timedOut: false };
			if (key.startsWith("git ls-remote")) return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
			if (
				key === "git hash-object -- a.txt" ||
				key === "git rev-parse :a.txt" ||
				key === `git rev-parse ${COMMIT_HEAD}:a.txt`
			) {
				return { exitCode: 0, stdout: `${"e".repeat(40)}\n`, stderr: "", timedOut: false };
			}
			if (key === "git add -- a.txt") {
				staged = true;
				return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
			}
			if (key === "git diff --cached --name-only -z")
				return { exitCode: 0, stdout: "a.txt\0", stderr: "", timedOut: false };
			if (key.startsWith("git commit --only -m ")) {
				head = COMMIT_HEAD;
				return { exitCode: 0, stdout: "committed", stderr: "", timedOut: false };
			}
			if (key === `git rev-parse ${COMMIT_HEAD}^`) {
				return { exitCode: 0, stdout: `${BASE_HEAD}\n`, stderr: "", timedOut: false };
			}
			if (key === `git diff-tree --no-commit-id --name-only -r -z ${COMMIT_HEAD}`) {
				return { exitCode: 0, stdout: "a.txt\0", stderr: "", timedOut: false };
			}
			return { exitCode: 1, stdout: "", stderr: "unsupported", timedOut: false };
		},
	};
}

async function createHarness(options = {}) {
	const cwd = await mkdtemp(join(tmpdir(), "byz-delivery-extension-"));
	await writeFile(join(cwd, "a.txt"), "changed");
	const runner = options.runner ?? createRunner(cwd);
	const handlers = new Map();
	const commands = new Map();
	const scopes = [];
	const results = [];
	const notifications = [];
	let answer = options.answer ?? "confirm";
	let idle = options.idle ?? true;
	let trusted = options.trusted ?? true;
	const context = {
		cwd,
		ui: { notify: (message, level) => notifications.push({ level, message }) },
		input: async () => (typeof answer === "function" ? answer() : answer),
		isIdle: () => idle,
		isProjectTrusted: () => trusted,
		readDeliveryScopeEntries: () => scopes,
	};
	const registry = {
		hasTask: () => true,
		snapshot: () => ({
			availability: "available",
			generation: 1,
			plan: {
				id: "plan-1",
				state: "terminal",
				total: 1,
				counts: {
					completed: 1,
					blocked: 0,
					cancelled: 0,
					verifiedEvidence: 1,
					verifiedPassedEvidence: 5,
					verifiedFailedEvidence: 0,
					verifiedPassedCategories: ["build", "check", "qa", "review", "test"],
				},
				active: { id: "task-1" },
			},
		}),
	};
	createDeliveryExtension({ ...options.extensionOptions, executionRegistry: registry, runner })({
		on: (name, handler) => handlers.set(name, handler),
		registerCommand: (name, command) => commands.set(name, command),
		appendScope: (entry) => scopes.push(entry),
		appendResult: (entry) => results.push(entry),
	});
	return {
		commands,
		context,
		cwd,
		handlers,
		notifications,
		async observeMutation(toolCallId = "call-1") {
			const event = { toolCallId, toolName: "write", path: "a.txt", outcome: "success" };
			await handlers.get("tool_execution_start")(event, context);
			await handlers.get("tool_execution_end")(event, context);
		},
		results,
		runner,
		scopes,
		setAnswer: (value) => {
			answer = value;
		},
		setIdle: (value) => {
			idle = value;
		},
		setTrusted: (value) => {
			trusted = value;
		},
	};
}

test("startup and normal lifecycle perform zero Git until explicit status", async () => {
	const harness = await createHarness();
	try {
		await harness.handlers.get("session_start")({}, harness.context);
		assert.equal(harness.runner.calls.length, 0);
		await harness.commands.get("deliver").handler("status", harness.context);
		assert.ok(harness.runner.calls.length > 0);
		assert.match(harness.notifications.at(-1).message, /^Delivery:/);
	} finally {
		await rm(harness.cwd, { force: true, recursive: true });
	}
});

test("commit confirmation stages only observed digest-current paths", async () => {
	const harness = await createHarness();
	try {
		await harness.handlers.get("session_start")({}, harness.context);
		await harness.observeMutation();
		await harness.commands.get("deliver").handler("commit", harness.context);
		assert.deepEqual(harness.runner.calls.find((call) => call.args[0] === "add")?.args, ["add", "--", "a.txt"]);
		assert.equal(harness.results.at(-1).outcome, "success");
		assert.equal(harness.results.at(-1).commitSha, COMMIT_HEAD);
	} finally {
		await rm(harness.cwd, { force: true, recursive: true });
	}
});

test("cancel, trust, running state, and fingerprint drift cause zero mutation", async () => {
	const harness = await createHarness({ answer: "no" });
	try {
		await harness.observeMutation();
		await harness.commands.get("deliver").handler("commit", harness.context);
		assert.equal(
			harness.runner.calls.some((call) => call.args[0] === "add"),
			false,
		);
		harness.setIdle(false);
		harness.setAnswer("confirm");
		await harness.commands.get("deliver").handler("commit", harness.context);
		assert.match(harness.notifications.at(-1).message, /agent is running/);
		harness.setIdle(true);
		harness.setTrusted(false);
		const calls = harness.runner.calls.length;
		await harness.commands.get("deliver").handler("status", harness.context);
		assert.equal(harness.runner.calls.length, calls);
	} finally {
		await rm(harness.cwd, { force: true, recursive: true });
	}
});

test("confirmation-time fingerprint drift consumes no mutation and records stale", async () => {
	const harness = await createHarness();
	try {
		await harness.observeMutation();
		harness.setAnswer(() => {
			harness.runner.setHead("d".repeat(40));
			return "confirm";
		});
		await harness.commands.get("deliver").handler("commit", harness.context);
		assert.equal(
			harness.runner.calls.some((call) => call.args[0] === "add"),
			false,
		);
		assert.equal(harness.results.at(-1).outcome, "stale");
		assert.match(harness.notifications.at(-1).message, /state changed/);
	} finally {
		await rm(harness.cwd, { force: true, recursive: true });
	}
});

test("missing outcome or mismatched tool end cannot enter delivery scope", async () => {
	const harness = await createHarness();
	try {
		await harness.handlers.get("tool_execution_start")(
			{ toolCallId: "missing", toolName: "write", path: "a.txt" },
			harness.context,
		);
		await harness.handlers.get("tool_execution_end")(
			{ toolCallId: "missing", toolName: "write", path: "a.txt" },
			harness.context,
		);
		await harness.handlers.get("tool_execution_start")(
			{ toolCallId: "mismatch", toolName: "write", path: "a.txt" },
			harness.context,
		);
		await harness.handlers.get("tool_execution_end")(
			{ toolCallId: "mismatch", toolName: "edit", path: "a.txt", outcome: "success" },
			harness.context,
		);
		assert.equal(harness.scopes.length, 0);
	} finally {
		await rm(harness.cwd, { force: true, recursive: true });
	}
});

test("duplicate or excessive mutation bindings fail scope closed until session reset", async () => {
	const harness = await createHarness();
	try {
		const event = { toolCallId: "duplicate", toolName: "write", path: "a.txt", outcome: "success" };
		await harness.handlers.get("tool_execution_start")(event, harness.context);
		await harness.handlers.get("tool_execution_start")(event, harness.context);
		await harness.handlers.get("tool_execution_end")(event, harness.context);
		assert.equal(harness.scopes.length, 0);
		await harness.handlers.get("session_start")({}, harness.context);
		await harness.observeMutation("fresh");
		assert.equal(harness.scopes.length, 1);
	} finally {
		await rm(harness.cwd, { force: true, recursive: true });
	}
});

test("one active confirmation locks out concurrent mutation commands", async () => {
	const harness = await createHarness();
	try {
		await harness.observeMutation();
		let releaseAnswer;
		const answer = new Promise((resolve) => {
			releaseAnswer = resolve;
		});
		harness.setAnswer(() => answer);
		const first = harness.commands.get("deliver").handler("commit", harness.context);
		await new Promise((resolve) => setImmediate(resolve));
		await harness.commands.get("deliver").handler("commit", harness.context);
		assert.match(harness.notifications.at(-1).message, /already active/);
		releaseAnswer("no");
		await first;
		assert.equal(
			harness.runner.calls.some((call) => call.args[0] === "add"),
			false,
		);
	} finally {
		await rm(harness.cwd, { force: true, recursive: true });
	}
});

test("PR temp cleanup failure is receipted and blocks later mutations", async () => {
	let cleanupAttempts = 0;
	const harness = await createHarness({
		extensionOptions: {
			checkGitHub: async () => true,
			removeDirectory: async (path, options) => {
				cleanupAttempts += 1;
				await rm(path, options);
				throw new Error("cleanup failed");
			},
		},
	});
	const originalRun = harness.runner.run.bind(harness.runner);
	harness.runner.run = async (program, args, options) => {
		const key = `${program} ${args.join(" ")}`;
		if (key.includes("@{upstream}")) return { exitCode: 0, stdout: "origin/feature\n", stderr: "", timedOut: false };
		if (key.startsWith("git status ")) return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
		if (key.startsWith("git ls-remote"))
			return { exitCode: 0, stdout: `${BASE_HEAD}\trefs/heads/feature\n`, stderr: "", timedOut: false };
		if (key.startsWith("gh pr create"))
			return { exitCode: 0, stdout: "https://github.com/acme/project/pull/7\n", stderr: "", timedOut: false };
		if (key === "gh pr view --repo acme/project --json number,url,headRefOid,baseRefName,isDraft") {
			return {
				exitCode: 0,
				stdout: JSON.stringify({ number: 7, isDraft: true, headRefOid: BASE_HEAD, baseRefName: "main" }),
				stderr: "",
				timedOut: false,
			};
		}
		return originalRun(program, args, options);
	};
	try {
		await harness.commands.get("deliver").handler("pr", harness.context);
		assert.equal(cleanupAttempts, 1);
		assert.equal(harness.results.at(-1).outcome, "partial");
		assert.ok(harness.results.at(-1).sideEffects.includes("cleanup_failed"));
		const callCount = harness.runner.calls.length;
		await harness.commands.get("deliver").handler("pr", harness.context);
		assert.equal(harness.runner.calls.length, callCount);
		assert.match(harness.notifications.at(-1).message, /cleanup failed/);
	} finally {
		await rm(harness.cwd, { force: true, recursive: true });
	}
});

test("isolated extension chain commits, pushes to a bare origin, and uses fake GitHub PR operations", async () => {
	const parent = await mkdtemp(join(tmpdir(), "byz-delivery-chain-"));
	const cwd = join(parent, "repo");
	const bare = join(parent, "origin.git");
	await mkdir(cwd);
	const handlers = new Map();
	const commands = new Map();
	const scopes = [];
	const results = [];
	const notifications = [];
	let terminal = false;
	const ghCalls = [];
	try {
		git(cwd, ["init", "-b", "feature"]);
		git(cwd, ["config", "user.name", "Test"]);
		git(cwd, ["config", "user.email", "test@example.com"]);
		await writeFile(join(cwd, "a.txt"), "base");
		git(cwd, ["add", "a.txt"]);
		git(cwd, ["commit", "-m", "base"]);
		git(parent, ["init", "--bare", bare]);
		git(cwd, ["remote", "add", "origin", bare]);
		git(cwd, ["push", "-u", "origin", "feature"]);
		await writeFile(join(cwd, "a.txt"), "scoped");
		const processRunner = createDeliveryProcessRunner();
		const runner = {
			run(program, args, options) {
				if (program === "git" && args.join(" ") === "remote get-url origin") {
					return Promise.resolve({
						exitCode: 0,
						stdout: "https://github.com/acme/project.git\n",
						stderr: "",
						timedOut: false,
					});
				}
				if (program === "git") return processRunner.run(program, args, options);
				ghCalls.push(args);
				const key = args.join(" ");
				if (key.startsWith("pr create "))
					return Promise.resolve({
						exitCode: 0,
						stdout: "https://github.com/acme/project/pull/7\n",
						stderr: "",
						timedOut: false,
					});
				if (key.includes("number,url,headRefOid,baseRefName,isDraft")) {
					return Promise.resolve({
						exitCode: 0,
						stdout: JSON.stringify({
							number: 7,
							isDraft: true,
							headRefOid: git(cwd, ["rev-parse", "HEAD"]),
							baseRefName: "main",
						}),
						stderr: "",
						timedOut: false,
					});
				}
				if (key.startsWith("pr merge "))
					return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", timedOut: false });
				return Promise.resolve({
					exitCode: 0,
					stdout: JSON.stringify({ state: "MERGED", mergedAt: "2026-09-03T00:00:00Z" }),
					stderr: "",
					timedOut: false,
				});
			},
		};
		const registry = {
			hasTask: () => true,
			snapshot: () => ({
				availability: "available",
				generation: 1,
				plan: {
					id: "plan-1",
					state: terminal ? "terminal" : "sealed",
					total: 1,
					counts: terminal
						? {
								completed: 1,
								blocked: 0,
								cancelled: 0,
								verifiedPassedEvidence: 5,
								verifiedFailedEvidence: 0,
								verifiedPassedCategories: ["build", "check", "qa", "review", "test"],
							}
						: {},
					...(terminal ? {} : { active: { id: "task-1" } }),
				},
			}),
		};
		const context = {
			cwd,
			input: async () => "confirm",
			isIdle: () => true,
			isProjectTrusted: () => true,
			readDeliveryScopeEntries: () => scopes,
			ui: { notify: (message, level) => notifications.push({ level, message }) },
		};
		const readPr = async () => ({
			base: "main",
			baseSha: "c".repeat(40),
			checks: "success",
			headSha: git(cwd, ["rev-parse", "HEAD"]),
			mergeable: true,
			number: 7,
			repository: "acme/project",
			requiredChecks: [{ appId: 42, context: "test", outcome: "passed" }],
		});
		createDeliveryExtension({ checkGitHub: async () => true, executionRegistry: registry, readPr, runner })({
			on: (name, handler) => handlers.set(name, handler),
			registerCommand: (name, command) => commands.set(name, command),
			appendScope: (entry) => scopes.push(entry),
			appendResult: (entry) => results.push(entry),
		});
		await handlers.get("session_start")({}, context);
		const mutation = { toolCallId: "write-1", toolName: "write", path: "a.txt" };
		await handlers.get("tool_execution_start")(mutation, context);
		await handlers.get("tool_execution_end")({ ...mutation, outcome: "success" }, context);
		terminal = true;
		await commands.get("deliver").handler("commit", context);
		await commands.get("deliver").handler("push", context);
		await commands.get("deliver").handler("pr", context);
		await commands.get("deliver").handler("merge", context);
		assert.deepEqual(
			results.map((entry) => entry.outcome),
			["success", "success", "success", "success"],
			JSON.stringify(notifications),
		);
		assert.equal(
			git(parent, ["--git-dir", bare, "rev-parse", "refs/heads/feature"]),
			git(cwd, ["rev-parse", "HEAD"]),
		);
		assert.ok(ghCalls.some((args) => args[0] === "pr" && args[1] === "create" && args.includes("--repo")));
		assert.ok(ghCalls.some((args) => args[0] === "pr" && args[1] === "merge" && args.includes("--repo")));
	} finally {
		await rm(parent, { force: true, recursive: true });
	}
});

test("release command is always read-only and no resume command is registered", async () => {
	const harness = await createHarness();
	try {
		await harness.commands.get("deliver").handler("release", harness.context);
		assert.ok(harness.runner.calls.length > 0);
		assert.equal(
			harness.runner.calls.some((call) => ["push", "commit", "tag"].includes(call.args[0])),
			false,
		);
		assert.match(harness.notifications.at(-1).message, /No release action is available/);
		assert.deepEqual([...harness.commands.keys()], ["deliver"]);
	} finally {
		await rm(harness.cwd, { force: true, recursive: true });
	}
});
