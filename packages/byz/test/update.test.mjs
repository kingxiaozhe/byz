import assert from "node:assert/strict";
import test from "node:test";
import { BYZ_PACKAGE_NAME, getLatestByzRelease, handleByzUpdate, planByzUpdate } from "../dist/update.js";
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
	const stdout = [];
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
		stdout: (line) => stdout.push(line),
	});

	assert.equal(handled, true);
	assert.equal(commands.length, 1);
	assert.deepEqual(commands[0].args.slice(0, 3), [
		"--@aibyzero:registry=https://registry.npmjs.org/",
		"--prefix",
		"/tmp/byz-prefix",
	]);
	assert.match(stdout.at(-1), /Updated BYZ from 0\.1\.0 to 0\.2\.0/);
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
	const stderr = [];
	process.exitCode = undefined;
	await handleByzUpdate(["update"], {
		currentVersion: "0.1.0",
		getLatestRelease: async () => ({ name: BYZ_PACKAGE_NAME, version: "0.2.0" }),
		getManualUpdateCommand: () => ({
			command: "npm",
			args: ["--prefix", "/tmp/byz-prefix", "install", "-g", `${BYZ_PACKAGE_NAME}@0.2.0`],
			display: `npm --prefix /tmp/byz-prefix install -g ${BYZ_PACKAGE_NAME}@0.2.0`,
		}),
		getUpdateCommand: () => undefined,
		stderr: (line) => stderr.push(line),
	});
	assert.equal(process.exitCode, 2);
	assert.match(stderr.join("\n"), /--@aibyzero:registry=https:\/\/registry\.npmjs\.org\//);
	assert.match(stderr.join("\n"), /--prefix \/tmp\/byz-prefix/);
	process.exitCode = undefined;
});

test("refuses source checkouts and unsupported Pi update options", async () => {
	const stderr = [];
	process.exitCode = undefined;
	await handleByzUpdate(["update"], {
		currentVersion: "0.1.0",
		getLatestRelease: async () => ({ name: BYZ_PACKAGE_NAME, version: "0.2.0" }),
		getManualUpdateCommand: () => undefined,
		getUpdateCommand: () => undefined,
		stderr: (line) => stderr.push(line),
	});
	assert.equal(process.exitCode, 2);
	assert.match(stderr.join("\n"), /npm-managed global/);

	process.exitCode = undefined;
	await handleByzUpdate(["update"], {
		currentVersion: "0.1.0",
		getLatestRelease: async () => ({ name: BYZ_PACKAGE_NAME, version: "0.2.0" }),
		getManualUpdateCommand: () => undefined,
		getUpdateCommand: () => ({ command: "pnpm", args: [], display: "pnpm install -g" }),
		stderr: (line) => stderr.push(line),
	});
	assert.equal(process.exitCode, 2);

	process.exitCode = undefined;
	await handleByzUpdate(["update", "--all"], { stderr: (line) => stderr.push(line) });
	assert.equal(process.exitCode, 1);
	assert.match(stderr.at(-1), /Expected only --force or --help/);
	process.exitCode = undefined;
});
