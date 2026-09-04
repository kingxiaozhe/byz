import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	applyCommandResult,
	createCommandRegistry,
	createHandledResult,
} from "../.byz-output/current/dist/application/command-registry.js";
import {
	createByzCommandRegistry,
	parseByzInvocation,
	tryParseByzInvocation,
} from "../.byz-output/current/dist/bootstrap.js";

test("registry returns uniform handled and passthrough command results", async () => {
	const registry = createCommandRegistry([
		{
			id: "fixture",
			parse: (args) => (args[0] === "fixture" ? args.slice(1) : undefined),
			execute: async (input) => createHandledResult({ stdout: [input.join("|")] }),
			runtime: "none",
		},
	]);

	assert.deepEqual(await registry.execute(["fixture", "a", "b"], {}), {
		status: "handled",
		exitCode: 0,
		stdout: ["a|b"],
		stderr: [],
	});
	assert.deepEqual(await registry.execute(["auth", "--help"], {}), {
		status: "passthrough",
		exitCode: 0,
		stdout: [],
		stderr: [],
	});
});

test("registry rejects duplicate command ids and normalizes thrown command failures", async () => {
	const command = {
		id: "same",
		parse: () => [],
		execute: async () => createHandledResult(),
		runtime: "none",
	};
	assert.throws(() => createCommandRegistry([command, command]), /Duplicate BYZ command id/);

	const registry = createCommandRegistry([
		{
			...command,
			id: "failure",
			execute: async () => {
				throw new Error("bounded failure");
			},
		},
	]);
	assert.deepEqual(await registry.execute(["anything"], {}), {
		status: "handled",
		exitCode: 1,
		stdout: [],
		stderr: ["bounded failure"],
	});
});

test("bootstrap parses BYZ Fast and workflow options once and preserves double dash passthrough", () => {
	const parsed = parseByzInvocation(["--fast", "--workflow", "none", "-p", "--", "--workflow", "cm"], {
		BYZ_FAST_MODEL: "openai/example-fast",
	});
	assert.equal(parsed.fast.enabled, true);
	assert.equal(parsed.workflowId, "none");
	assert.deepEqual(parsed.commandArgs, ["-p", "--", "--workflow", "cm"]);
	assert.deepEqual(parsed.passthroughArgs, [
		"--model",
		"openai/example-fast",
		"--thinking",
		"low",
		"-p",
		"--",
		"--workflow",
		"cm",
	]);
});

test("bootstrap converts BYZ option parse failures into CommandResult", () => {
	assert.deepEqual(tryParseByzInvocation(["--fast", "--fast"]), {
		result: {
			status: "handled",
			exitCode: 1,
			stdout: [],
			stderr: ["--fast may only be specified once."],
		},
	});
});

test("BYZ registry dispatches commands without mutating process exit state", async () => {
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		const registry = createByzCommandRegistry();
		const result = await registry.execute(["update", "--all"], {
			update: { stderr: () => assert.fail("business commands must return output instead of writing it") },
		});
		assert.equal(result.status, "handled");
		assert.equal(result.exitCode, 1);
		assert.match(result.stderr[0], /Expected only --force or --help/);
		assert.equal(process.exitCode, undefined);
	} finally {
		process.exitCode = originalExitCode;
	}
});

test("only explicit result application writes streams and exit code", () => {
	const stdout = [];
	const stderr = [];
	let exitCode;
	applyCommandResult(createHandledResult({ exitCode: 2, stdout: ["out"], stderr: ["err"] }), {
		stdout: (line) => stdout.push(line),
		stderr: (line) => stderr.push(line),
		setExitCode: (value) => {
			exitCode = value;
		},
	});
	assert.deepEqual(stdout, ["out"]);
	assert.deepEqual(stderr, ["err"]);
	assert.equal(exitCode, 2);
});

test("BYZ business command modules do not control the global exit code", async () => {
	for (const path of ["../src/diagnostics/commands.js", "../src/workflows.js", "../src/update.js"]) {
		const source = await readFile(new URL(path, import.meta.url), "utf8");
		assert.doesNotMatch(source, /process\.exitCode/);
	}
});
