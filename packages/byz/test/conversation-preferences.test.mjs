import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createConversationController } from "../src/conversation/conversation-controller.js";
import { createConversationPreferencesRepository } from "../src/conversation/conversation-preferences.js";

async function runUpdater(moduleUrl, configPath, changes, publishDelayMs = 0) {
	const script = `import { createConversationPreferencesRepository } from ${JSON.stringify(moduleUrl)}; const delay=Number(process.argv[3]); await createConversationPreferencesRepository({ configPath: process.argv[1], beforePublish: delay > 0 ? async () => new Promise((resolve) => setTimeout(resolve, delay)) : undefined }).update(JSON.parse(process.argv[2]));`;
	await new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			["--input-type=module", "-e", script, configPath, JSON.stringify(changes), String(publishDelayMs)],
			{
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let stderr = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(stderr || `updater exited ${code}`));
		});
	});
}

test("concurrent processes preserve language and detail in independent atomic cells", async () => {
	const directory = await mkdtemp(join(tmpdir(), "byz-preferences-concurrent-"));
	try {
		const configPath = join(directory, "agent", "conversation.json");
		const moduleUrl = new URL("../src/conversation/conversation-preferences.js", import.meta.url).href;
		await Promise.all([
			runUpdater(moduleUrl, configPath, { language: "en" }),
			runUpdater(moduleUrl, configPath, { detailMode: "details" }),
		]);
		const result = createConversationPreferencesRepository({ configPath }).read();
		assert.deepEqual(result.preferences, { detailMode: "details", language: "en", revision: 2 });
		assert.equal(result.diagnostic.state, "ok");
		assert.equal((await stat(join(directory, "agent"))).mode & 0o777, 0o700);
		const cellDirectory = `${configPath}.d`;
		assert.equal((await stat(join(cellDirectory, "language.json"))).mode & 0o777, 0o600);
		assert.equal((await stat(join(cellDirectory, "detail-mode.json"))).mode & 0o777, 0o600);
		assert.ok(!(await readdir(join(directory, "agent"))).some((name) => name.endsWith(".lock")));
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test("same-field concurrent updates allow one winner and explicitly reject contention", async () => {
	const directory = await mkdtemp(join(tmpdir(), "byz-preferences-same-field-"));
	try {
		const configPath = join(directory, "agent", "conversation.json");
		const moduleUrl = new URL("../src/conversation/conversation-preferences.js", import.meta.url).href;
		const outcomes = await Promise.allSettled([
			runUpdater(moduleUrl, configPath, { language: "en" }, 200),
			runUpdater(moduleUrl, configPath, { language: "zh" }, 200),
		]);
		assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
		assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
		const result = createConversationPreferencesRepository({ configPath }).read();
		assert.ok(["en", "zh"].includes(result.preferences.language));
		assert.equal(result.preferences.revision, 1);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test("recovers a complete next-revision claim after its owner exits", async () => {
	const directory = await mkdtemp(join(tmpdir(), "byz-preferences-claim-recovery-"));
	try {
		const configPath = join(directory, "conversation.json");
		const cellDirectory = `${configPath}.d`;
		await mkdir(cellDirectory);
		await writeFile(
			join(cellDirectory, ".language.json.next-1"),
			`${JSON.stringify({ field: "language", ownerPid: 99999999, revision: 1, schemaVersion: 1, value: "zh" })}\n`,
			{ mode: 0o600 },
		);
		const repository = createConversationPreferencesRepository({ configPath });
		await repository.update({ language: "en" });
		assert.deepEqual(repository.read().preferences, { detailMode: "compact", language: "en", revision: 2 });
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test("first run reports missing and does not chmod an existing shared ancestor", async () => {
	const directory = await mkdtemp(join(tmpdir(), "byz-preferences-first-run-"));
	try {
		await chmod(directory, 0o755);
		const configPath = join(directory, "new", "agent", "conversation.json");
		const repository = createConversationPreferencesRepository({ configPath });
		assert.equal(repository.read().diagnostic.state, "missing");
		await repository.update({ language: "en" });
		assert.equal((await stat(directory)).mode & 0o777, 0o755);
		assert.equal((await stat(join(directory, "new", "agent"))).mode & 0o777, 0o700);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test("repairs legacy permissions and enforces strict versioned fields", async () => {
	const directory = await mkdtemp(join(tmpdir(), "byz-preferences-migration-"));
	try {
		const agentDir = join(directory, "agent");
		const configPath = join(agentDir, "conversation.json");
		await mkdir(agentDir, { mode: 0o755 });
		await writeFile(configPath, '{"language":"en","detailMode":"details"}\n', { mode: 0o644 });
		const repository = createConversationPreferencesRepository({ configPath });
		assert.deepEqual(repository.read().preferences, { detailMode: "details", language: "en", revision: 0 });
		assert.equal((await stat(agentDir)).mode & 0o777, 0o700);
		assert.equal((await stat(configPath)).mode & 0o777, 0o600);
		await repository.update({ language: "zh" });
		assert.deepEqual(repository.read().preferences, { detailMode: "details", language: "zh", revision: 1 });
		await assert.rejects(repository.update({ language: undefined }), /one valid field/);
		const partial = createConversationPreferencesRepository({ configPath: join(directory, "partial.json") });
		await writeFile(join(directory, "partial.json"), '{"language":"en","detailMode":"invalid"}\n', { mode: 0o600 });
		assert.equal(partial.read().preferences.language, "en");
		assert.equal(partial.read().preferences.detailMode, "compact");
		assert.equal(partial.read().diagnostic.state, "corrupt");
		await writeFile(configPath, '{"schemaVersion":1,"revision":0,"language":"en"}\n', { mode: 0o600 });
		assert.equal(repository.read().diagnostic.state, "corrupt");
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test("corrupt preferences are quarantined with a diagnostic default", async () => {
	const directory = await mkdtemp(join(tmpdir(), "byz-preferences-corrupt-"));
	try {
		const configPath = join(directory, "conversation.json");
		await writeFile(configPath, "{not-json", { mode: 0o600 });
		const repository = createConversationPreferencesRepository({ configPath, now: () => 123 });
		const result = repository.read();
		assert.equal(result.diagnostic.state, "corrupt");
		assert.equal(result.diagnostic.quarantined, "conversation.json.corrupt");
		assert.deepEqual(result.preferences, { detailMode: "compact", language: "auto", revision: 0 });
		assert.equal(await readFile(configPath, "utf8"), "{not-json");
		assert.ok((await readdir(directory)).some((name) => name === result.diagnostic.quarantined));
		repository.read();
		repository.read();
		assert.equal((await readdir(directory)).filter((name) => name.endsWith(".corrupt")).length, 1);
		await chmod(join(directory, "conversation.json.corrupt"), 0o644);
		repository.read();
		assert.equal((await stat(join(directory, "conversation.json.corrupt"))).mode & 0o777, 0o600);
		await writeFile(join(directory, "conversation.json.corrupt"), Buffer.alloc(16 * 1024 + 1));
		assert.equal(repository.read().diagnostic.quarantined, undefined);
		await repository.update({ language: "zh" });
		assert.deepEqual(repository.read().preferences, { detailMode: "compact", language: "zh", revision: 1 });
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test("controller surfaces unavailable initialization diagnostics", () => {
	const diagnostics = [];
	const controller = createConversationController({
		onPreferenceDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		preferencesRepository: {
			read: () => ({
				diagnostic: Object.freeze({ state: "unavailable" }),
				preferences: Object.freeze({ detailMode: "compact", language: "auto", revision: 0 }),
			}),
			update: async () => assert.fail("initialization must not write preferences"),
		},
	});
	const notifications = [];
	controller.onSessionStart(
		{},
		{
			ui: {
				input: async () => undefined,
				notify: (message, level) => notifications.push({ level, message }),
				setConfirmationPresenter() {},
				setFooter() {},
				setMessagePresenter() {},
				setTitle() {},
				setToolExecutionVisible() {},
			},
		},
	);
	assert.deepEqual(diagnostics, [{ state: "unavailable" }]);
	assert.ok(
		notifications.some(
			(entry) => entry.level === "warning" && /偏好设置不可用|preferences are unavailable/.test(entry.message),
		),
	);
});

test("directory replacement during publication fails before writing outside", async () => {
	const directory = await mkdtemp(join(tmpdir(), "byz-preferences-directory-race-"));
	try {
		const configPath = join(directory, "agent", "conversation.json");
		const cellDirectory = `${configPath}.d`;
		const backup = `${cellDirectory}.backup`;
		const outside = join(directory, "outside");
		await mkdir(join(directory, "agent"));
		await mkdir(outside);
		const repository = createConversationPreferencesRepository({
			configPath,
			beforePublish: async () => {
				await rename(cellDirectory, backup);
				await symlink(outside, cellDirectory, "dir");
			},
		});
		await assert.rejects(repository.update({ language: "en" }));
		assert.deepEqual(await readdir(outside), []);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test("destination replacement fails without following the target", async () => {
	const directory = await mkdtemp(join(tmpdir(), "byz-preferences-destination-race-"));
	try {
		const configPath = join(directory, "conversation.json");
		const target = join(directory, "outside.json");
		await writeFile(target, "keep");
		const repository = createConversationPreferencesRepository({
			configPath,
			beforePublish: async () => symlink(target, join(`${configPath}.d`, "language.json")),
		});
		await assert.rejects(repository.update({ language: "en" }), /destination is unsafe/);
		assert.equal(await readFile(target, "utf8"), "keep");
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test("symlinked preference directories fail closed without touching external files", async () => {
	const directory = await mkdtemp(join(tmpdir(), "byz-preferences-directory-link-"));
	try {
		const outside = join(directory, "outside");
		const linked = join(directory, "agent");
		await mkdir(outside);
		await writeFile(join(outside, "conversation.json"), '{"language":"en"}\n');
		await symlink(outside, linked, "dir");
		const repository = createConversationPreferencesRepository({ configPath: join(linked, "conversation.json") });
		assert.equal(repository.read().diagnostic.state, "unavailable");
		await assert.rejects(repository.update({ detailMode: "details" }));
		assert.equal(await readFile(join(outside, "conversation.json"), "utf8"), '{"language":"en"}\n');
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test("unsafe preference symlinks fail closed without touching their target", async () => {
	const directory = await mkdtemp(join(tmpdir(), "byz-preferences-symlink-"));
	try {
		const target = join(directory, "outside.json");
		const configPath = join(directory, "conversation.json");
		await writeFile(target, '{"keep":true}\n');
		await symlink(target, configPath);
		const repository = createConversationPreferencesRepository({ configPath });
		assert.equal(repository.read().diagnostic.state, "unavailable");
		await assert.rejects(repository.update({ language: "en" }), /unavailable/);
		assert.equal(await readFile(target, "utf8"), '{"keep":true}\n');
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});
