import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createGitHeadReader, readGitHead } from "../src/recovery/git-head.js";

function createChild() {
	const child = new EventEmitter();
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.killCalls = [];
	child.kill = (signal) => {
		child.killCalls.push(signal);
		return true;
	};
	return child;
}

function createSpawn(run) {
	const calls = [];
	const spawn = (...args) => {
		calls.push(args);
		const child = createChild();
		queueMicrotask(() => run(child));
		return child;
	};
	spawn.calls = calls;
	return spawn;
}

test("importing and constructing readers perform zero spawn", () => {
	const spawn = createSpawn(() => assert.fail("spawn must remain lazy"));
	const reader = createGitHeadReader({ spawn });

	assert.equal(typeof readGitHead, "function");
	assert.equal(typeof reader, "function");
	assert.equal(spawn.calls.length, 0);
});

test("returns a validated 12-character lower-case HEAD", async () => {
	const spawn = createSpawn((child) => {
		child.stdout.emit("data", Buffer.from("0123456789abcdef0123456789abcdef01234567\n"));
		child.emit("close", 0);
	});

	const result = await createGitHeadReader({ spawn })("/fixed/project");

	assert.equal(result, "0123456789ab");
});

test("uses only the fixed executable, argv, cwd, environment, and spawn options", async () => {
	const spawn = createSpawn((child) => child.emit("close", 1));
	const reader = createGitHeadReader({ spawn });

	const previousGitDir = process.env.GIT_DIR;
	process.env.GIT_DIR = "/attacker-controlled/repository";
	try {
		await reader("/fixed/project");
	} finally {
		if (previousGitDir === undefined) delete process.env.GIT_DIR;
		else process.env.GIT_DIR = previousGitDir;
	}

	assert.equal(spawn.calls.length, 1);
	const [executable, argv, options] = spawn.calls[0];
	assert.equal(executable, "git");
	assert.deepEqual(argv, ["rev-parse", "--verify", "HEAD"]);
	assert.equal(options.cwd, "/fixed/project");
	assert.equal(options.shell, false);
	assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
	assert.equal(options.env.GIT_OPTIONAL_LOCKS, "0");
	assert.equal(options.env.GIT_TERMINAL_PROMPT, "0");
	assert.equal(options.env.PATH, process.env.PATH);
	assert.equal(options.env.GIT_DIR, undefined);
	assert.equal(
		Object.keys(options.env).every((key) =>
			["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "GIT_OPTIONAL_LOCKS", "GIT_TERMINAL_PROMPT"].includes(
				key,
			),
		),
		true,
	);
	assert.deepEqual(Object.keys(options).sort(), ["cwd", "env", "shell", "stdio"]);
});

test("maps missing Git and nonzero exit to allowlisted unavailable reasons", async (t) => {
	await t.test("missing executable", async () => {
		const spawn = createSpawn((child) => child.emit("error", new Error("sensitive path")));
		assert.deepEqual(await createGitHeadReader({ spawn })("/secret/path"), {
			state: "unavailable",
			reasonCode: "git-unavailable",
		});
	});

	await t.test("nonzero exit", async () => {
		const spawn = createSpawn((child) => {
			child.stderr.emit("data", Buffer.from("raw repository error"));
			child.emit("close", 128);
		});
		assert.deepEqual(await createGitHeadReader({ spawn })("/secret/path"), {
			state: "unavailable",
			reasonCode: "command-failed",
		});
	});
});

test("rejects malformed or non-lower-case output without exposing it", async () => {
	for (const output of [
		"0123456789ABCDEF0123456789ABCDEF01234567\n",
		"branch main 0123456789abcdef0123456789abcdef01234567\n",
		" 0123456789abcdef0123456789abcdef01234567 \n",
		"0123456\n",
	]) {
		const spawn = createSpawn((child) => {
			child.stdout.emit("data", Buffer.from(output));
			child.emit("close", 0);
		});
		assert.deepEqual(await createGitHeadReader({ spawn })("/fixed/project"), {
			state: "unavailable",
			reasonCode: "invalid-output",
		});
	}
});

test("terminates and degrades when the fixed timeout elapses", async () => {
	let child;
	const spawn = (...args) => {
		spawn.calls.push(args);
		child = createChild();
		return child;
	};
	spawn.calls = [];
	const reader = createGitHeadReader({ spawn });

	assert.deepEqual(await reader("/fixed/project"), {
		state: "unavailable",
		reasonCode: "timeout",
	});
	assert.deepEqual(spawn.calls[0][2].shell, false);
	assert.deepEqual(child.killCalls, ["SIGKILL"]);
});

test("terminates on stdout or stderr overflow", async (t) => {
	for (const [name, stream, bytes] of [
		["stdout", "stdout", 129],
		["stderr", "stderr", 1_025],
	]) {
		await t.test(name, async () => {
			let child;
			const spawn = (...args) => {
				spawn.calls.push(args);
				child = createChild();
				queueMicrotask(() => child[stream].emit("data", Buffer.alloc(bytes)));
				return child;
			};
			spawn.calls = [];

			assert.deepEqual(await createGitHeadReader({ spawn })("/fixed/project"), {
				state: "unavailable",
				reasonCode: "output-overflow",
			});
			assert.deepEqual(child.killCalls, ["SIGKILL"]);
		});
	}
});
