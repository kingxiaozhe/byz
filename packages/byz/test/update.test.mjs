import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
	BYZ_PACKAGE_NAME,
	getLatestByzRelease,
	handleByzUpdate,
	planByzUpdate,
	runSelfUpdateCommand,
} from "../.byz-output/current/dist/update.js";
import { runUpdateWithDiagnostics } from "../src/diagnostics/update-integration.js";

test("reads only the fixed BYZ npm registry endpoint", async () => {
	const requests = [];
	const release = await getLatestByzRelease("0.1.0", {
		fetch: async (url, init) => {
			requests.push({ url, init });
			return {
				ok: true,
				status: 200,
				async json() {
					return { name: BYZ_PACKAGE_NAME, version: "0.2.0" };
				},
			};
		},
	});

	assert.deepEqual(release, { name: BYZ_PACKAGE_NAME, version: "0.2.0" });
	assert.equal(requests.length, 1);
	assert.equal(requests[0].url, "https://registry.npmjs.org/@aibyzero%2fbyz/latest");
	assert.equal(requests[0].init.redirect, "error");
	assert.match(requests[0].init.headers["User-Agent"], /^byz\/0\.1\.0$/);
});

test("rejects registry identity substitution and malformed versions", async () => {
	for (const payload of [
		{ name: "@earendil-works/pi-coding-agent", version: "0.2.0" },
		{ name: BYZ_PACKAGE_NAME, version: "latest" },
		{ name: BYZ_PACKAGE_NAME, version: "v0.2.0" },
	]) {
		await assert.rejects(
			getLatestByzRelease("0.1.0", {
				fetch: async () => ({ ok: true, status: 200, json: async () => payload }),
			}),
			/invalid BYZ release metadata/,
		);
	}
});

test("plans upgrades without downgrading", () => {
	assert.deepEqual(planByzUpdate("0.1.0", "0.2.0"), { action: "update", version: "0.2.0" });
	assert.deepEqual(planByzUpdate("0.2.0", "0.2.0"), { action: "current", version: "0.2.0" });
	assert.deepEqual(planByzUpdate("0.3.0", "0.2.0"), { action: "ahead", version: "0.2.0" });
	assert.deepEqual(planByzUpdate("0.2.0", "0.2.0", { force: true }), {
		action: "update",
		version: "0.2.0",
	});
	assert.throws(() => planByzUpdate("0.1.0", "invalid"), /invalid semantic version/);
});

test("updates only a writable global BYZ installation", async () => {
	const commands = [];
	const handled = await handleByzUpdate(["update"], {
		currentVersion: "0.1.0",
		getLatestRelease: async () => ({ name: BYZ_PACKAGE_NAME, version: "0.2.0" }),
		getUpdateCommand: (installedPackage, npmCommand, target) => {
			assert.equal(installedPackage, BYZ_PACKAGE_NAME);
			assert.equal(npmCommand, undefined);
			assert.deepEqual(target, {
				packageName: BYZ_PACKAGE_NAME,
				installSpec: `${BYZ_PACKAGE_NAME}@0.2.0`,
			});
			return {
				command: "npm",
				args: ["--prefix", "/tmp/byz-prefix", "install", "-g", `${BYZ_PACKAGE_NAME}@0.2.0`],
				display: `npm --prefix /tmp/byz-prefix install -g ${BYZ_PACKAGE_NAME}@0.2.0`,
			};
		},
		runCommand: async (command) => commands.push(command),
	});

	assert.equal(handled.status, "handled");
	assert.equal(handled.exitCode, 0);
	assert.equal(commands.length, 1);
	assert.deepEqual(commands[0].args.slice(0, 3), [
		"--@aibyzero:registry=https://registry.npmjs.org/",
		"--prefix",
		"/tmp/byz-prefix",
	]);
	assert.match(handled.stdout.at(-1), /Updated BYZ from 0\.1\.0 to 0\.2\.0/);
});

test("captures real update subprocess output in the successful CommandResult", async () => {
	const spawnCalls = [];
	const result = await handleByzUpdate(["update"], {
		currentVersion: "0.1.0",
		getLatestRelease: async () => ({ name: BYZ_PACKAGE_NAME, version: "0.2.0" }),
		getUpdateCommand: () => ({ command: "npm", args: ["install"], display: "npm install" }),
		spawnProcess(command, args, options) {
			spawnCalls.push({ command, args, options });
			const child = new EventEmitter();
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = () => true;
			queueMicrotask(() => {
				child.stdout.end("npm output\n");
				child.stderr.end("npm warning\n");
				child.emit("close", 0, null);
			});
			return child;
		},
		stdout: () => assert.fail("update output must not bypass CommandResult"),
		stderr: () => assert.fail("update output must not bypass CommandResult"),
	});

	assert.deepEqual(spawnCalls[0].options, { shell: false, stdio: ["inherit", "pipe", "pipe"] });
	assert.match(result.stdout[0], /^Updating BYZ with npm --@aibyzero:registry=/);
	assert.deepEqual(result.stdout.slice(1), [
		"npm output",
		"Updated BYZ from 0.1.0 to 0.2.0. Restart BYZ to use the new version.",
	]);
	assert.deepEqual(result.stderr, ["npm warning"]);
	assert.equal(result.exitCode, 0);
});

test("retains failed update subprocess output and exit status in CommandResult", async () => {
	const result = await handleByzUpdate(["update"], {
		currentVersion: "0.1.0",
		getLatestRelease: async () => ({ name: BYZ_PACKAGE_NAME, version: "0.2.0" }),
		getUpdateCommand: () => ({ command: "npm", args: ["install"], display: "npm install" }),
		spawnProcess() {
			const child = new EventEmitter();
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = () => true;
			queueMicrotask(() => {
				child.stdout.end("partial output\n");
				child.stderr.end("npm failed\n");
				child.emit("close", 7, null);
			});
			return child;
		},
	});

	assert.equal(result.exitCode, 7);
	assert.match(result.stdout[0], /^Updating BYZ with npm --@aibyzero:registry=/);
	assert.deepEqual(result.stdout.slice(1), ["partial output"]);
	assert.equal(result.stderr[0], "npm failed");
	assert.match(result.stderr[1], /^npm --@aibyzero:registry=.* exited with code 7\.$/);
});

test("bounds stdout overflow with TERM-to-KILL fallback even without close", async () => {
	const killCalls = [];
	const result = await Promise.race([
		handleByzUpdate(["update"], {
			currentVersion: "0.1.0",
			getLatestRelease: async () => ({ name: BYZ_PACKAGE_NAME, version: "0.2.0" }),
			getUpdateCommand: () => ({ command: "npm", args: ["install"], display: "npm install" }),
			spawnProcess() {
				const child = new EventEmitter();
				child.stdout = new PassThrough();
				child.stderr = new PassThrough();
				child.kill = (signal) => {
					killCalls.push(signal);
					return true;
				};
				queueMicrotask(() => child.stdout.write("123456789"));
				return child;
			},
			updateProcessOptions: { maxOutputBytes: 8, terminateGraceMs: 1, forceKillGraceMs: 1 },
		}),
		new Promise((_, reject) => setTimeout(() => reject(new Error("overflow did not settle")), 200)),
	]);

	assert.deepEqual(killCalls, ["SIGTERM", "SIGKILL"]);
	assert.equal(result.exitCode, 1);
	assert.match(result.stderr.at(-1), /stdout exceeded.*did not close after forced termination/);
});

test("bounds stderr overflow when TERM and KILL are not accepted", async () => {
	const killCalls = [];
	const result = await Promise.race([
		handleByzUpdate(["update"], {
			currentVersion: "0.1.0",
			getLatestRelease: async () => ({ name: BYZ_PACKAGE_NAME, version: "0.2.0" }),
			getUpdateCommand: () => ({ command: "npm", args: ["install"], display: "npm install" }),
			spawnProcess() {
				const child = new EventEmitter();
				child.stdout = new PassThrough();
				child.stderr = new PassThrough();
				child.kill = (signal) => {
					killCalls.push(signal);
					child.emit("error", new Error("EPERM"));
					return false;
				};
				queueMicrotask(() => child.stderr.write("123456789"));
				return child;
			},
			updateProcessOptions: { maxOutputBytes: 8, terminateGraceMs: 20, forceKillGraceMs: 1 },
		}),
		new Promise((_, reject) => setTimeout(() => reject(new Error("overflow did not settle")), 200)),
	]);

	assert.deepEqual(killCalls, ["SIGTERM", "SIGKILL"]);
	assert.equal(result.exitCode, 1);
	assert.match(result.stderr.at(-1), /stderr exceeded.*Force termination was not accepted/);
});

test("retains successful prior-step output when a later update step fails", async () => {
	let spawnCount = 0;
	const result = await handleByzUpdate(["update"], {
		currentVersion: "0.1.0",
		getLatestRelease: async () => ({ name: BYZ_PACKAGE_NAME, version: "0.2.0" }),
		getUpdateCommand: () => ({
			command: "npm",
			args: ["first"],
			display: "npm first",
			steps: [
				{ command: "npm", args: ["first"], display: "npm first" },
				{ command: "npm", args: ["second"], display: "npm second" },
			],
		}),
		spawnProcess() {
			const child = new EventEmitter();
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = () => true;
			const current = spawnCount++;
			queueMicrotask(() => {
				child.stdout.end(current === 0 ? "first output\n" : "second partial\n");
				child.stderr.end(current === 0 ? "" : "second failed\n");
				child.emit("close", current === 0 ? 0 : 9, null);
			});
			return child;
		},
	});

	assert.equal(result.exitCode, 9);
	assert.deepEqual(result.stdout.slice(1), ["first output", "second partial"]);
	assert.equal(result.stderr[0], "second failed");
	assert.match(result.stderr[1], /second.*exited with code 9/);
});

test("detaches real child handles when a descendant retains update pipes", async () => {
	const startedAt = performance.now();
	const operation = runSelfUpdateCommand(
		{
			command: process.execPath,
			args: [
				"-e",
				"require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},500)'],{stdio:['ignore',1,2]});process.stdout.write('123456789');setTimeout(()=>{},5000)",
			],
			display: "node overflow fixture",
		},
		undefined,
		{ maxOutputBytes: 8, terminateGraceMs: 5, forceKillGraceMs: 5 },
	);
	await assert.rejects(
		Promise.race([
			operation,
			new Promise((_, reject) => setTimeout(() => reject(new Error("real overflow did not settle")), 200)),
		]),
		(error) => error.result?.exitCode === 1 && /stdout exceeded/.test(error.result.stderr.at(-1)),
	);
	assert.ok(performance.now() - startedAt < 200);
});

test("resolves npm through node on Windows without a command shell", async () => {
	const calls = [];
	const result = await runSelfUpdateCommand(
		{ command: "npm", args: ["install"], display: "npm install" },
		(command, args, options) => {
			calls.push({ command, args, options });
			const child = new EventEmitter();
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			queueMicrotask(() => child.emit("close", 0, null));
			return child;
		},
		{ platform: "win32", nodeExecutable: "C:\\node\\node.exe", npmCliPath: "C:\\node\\npm-cli.js" },
	);
	assert.equal(result.exitCode, 0);
	assert.deepEqual(calls[0], {
		command: "C:\\node\\node.exe",
		args: ["C:\\node\\npm-cli.js", "install"],
		options: { shell: false, stdio: ["inherit", "pipe", "pipe"] },
	});
});

test("normalizes native exit statuses while retaining their diagnostic text", async () => {
	const result = await handleByzUpdate(["update"], {
		currentVersion: "0.1.0",
		getLatestRelease: async () => ({ name: BYZ_PACKAGE_NAME, version: "0.2.0" }),
		getUpdateCommand: () => ({ command: "npm", args: ["install"], display: "npm install" }),
		spawnProcess() {
			const child = new EventEmitter();
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = () => true;
			queueMicrotask(() => child.emit("close", 0xc0000005, null));
			return child;
		},
	});
	assert.equal(result.exitCode, 1);
	assert.match(result.stderr.at(-1), /3221225477/);
});

test("diagnostics remain best effort and preserve update rejection identity", async () => {
	const rejection = new Error("update failed");
	const calls = [];
	await assert.rejects(
		runUpdateWithDiagnostics({
			command: { command: "npm", args: ["install"] },
			fromVersion: "0.1.0",
			toVersion: "0.2.0",
			identity: "node-test",
			runCommand: async () => Promise.reject(rejection),
			diagnostics: {
				captureUpdateBaseline: (value) => calls.push(["baseline", value]),
				recordUpdateResult: (value) => calls.push(["result", value]),
			},
		}),
		(error) => error === rejection,
	);
	assert.equal(calls[0][0], "baseline");
	assert.equal(calls[1][0], "result");
	assert.equal(calls[1][1].outcome, "command_failed");

	await runUpdateWithDiagnostics({
		command: { command: "npm", args: ["install"] },
		fromVersion: "0.1.0",
		toVersion: "0.2.0",
		identity: "node-test",
		runCommand: async () => {},
		diagnostics: {
			captureUpdateBaseline: () => {
				throw new Error("diagnostics unavailable");
			},
			recordUpdateResult: () => {
				throw new Error("diagnostics unavailable");
			},
		},
	});
});

test("preserves a custom prefix in non-writable fallback guidance", async () => {
	const result = await handleByzUpdate(["update"], {
		currentVersion: "0.1.0",
		getLatestRelease: async () => ({ name: BYZ_PACKAGE_NAME, version: "0.2.0" }),
		getManualUpdateCommand: () => ({
			command: "npm",
			args: ["--prefix", "/tmp/byz-prefix", "install", "-g", `${BYZ_PACKAGE_NAME}@0.2.0`],
			display: `npm --prefix /tmp/byz-prefix install -g ${BYZ_PACKAGE_NAME}@0.2.0`,
		}),
		getUpdateCommand: () => undefined,
	});
	assert.equal(result.exitCode, 2);
	assert.match(result.stderr.join("\n"), /--@aibyzero:registry=https:\/\/registry\.npmjs\.org\//);
	assert.match(result.stderr.join("\n"), /--prefix \/tmp\/byz-prefix/);
});

test("refuses source checkouts and unsupported Pi update options", async () => {
	const sourceResult = await handleByzUpdate(["update"], {
		currentVersion: "0.1.0",
		getLatestRelease: async () => ({ name: BYZ_PACKAGE_NAME, version: "0.2.0" }),
		getManualUpdateCommand: () => undefined,
		getUpdateCommand: () => undefined,
	});
	assert.equal(sourceResult.exitCode, 2);
	assert.match(sourceResult.stderr.join("\n"), /npm-managed global/);

	const unsupportedResult = await handleByzUpdate(["update"], {
		currentVersion: "0.1.0",
		getLatestRelease: async () => ({ name: BYZ_PACKAGE_NAME, version: "0.2.0" }),
		getManualUpdateCommand: () => undefined,
		getUpdateCommand: () => ({ command: "pnpm", args: [], display: "pnpm install -g" }),
	});
	assert.equal(unsupportedResult.exitCode, 2);

	const invalidResult = await handleByzUpdate(["update", "--all"]);
	assert.equal(invalidResult.exitCode, 1);
	assert.match(invalidResult.stderr.at(-1), /Expected only --force or --help/);
});
