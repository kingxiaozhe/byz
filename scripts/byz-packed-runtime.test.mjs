import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { VirtualTerminal } from "../packages/tui/test/virtual-terminal.ts";

const packageDir = fileURLToPath(new URL("../packages/byz/", import.meta.url));

function run(command, args, options = {}) {
	return execFileSync(command, args, {
		encoding: "utf8",
		maxBuffer: 10 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
		...options,
	});
}

async function listFiles(root, relativeRoot = "") {
	const files = [];
	for (const entry of await readdir(join(root, relativeRoot), { withFileTypes: true })) {
		const relativePath = relativeRoot ? join(relativeRoot, entry.name) : entry.name;
		if (entry.isDirectory()) files.push(...(await listFiles(root, relativePath)));
		else if (entry.isFile()) files.push(relativePath.replaceAll("\\", "/"));
	}
	return files;
}

async function snapshotFiles(root) {
	const entries = [];
	for (const relativePath of await listFiles(root)) {
		entries.push([relativePath, createHash("sha256").update(await readFile(join(root, relativePath))).digest("hex")]);
	}
	return entries;
}

function hasStableRecovery(output) {
	return (
		output.includes("Project recovery") &&
		output.includes("Task: T-008") &&
		output.includes("BYZ 本地诊断已开启")
	);
}

function createCurrentScreenOracle(columns = 100, rows = 30) {
	const terminal = new VirtualTerminal(columns, rows);
	let pending = Promise.resolve("");
	return Object.freeze({
		push(chunk) {
			pending = pending.then(async () => {
				terminal.write(chunk);
				return (await terminal.flushAndGetViewport()).join("\n");
			});
			return pending;
		},
	});
}

function pushPtyChunk(screen, chunk) {
	return screen.push(chunk);
}

test("current-screen oracle rejects recovery markers erased before diagnostics", async () => {
	const overwritten = createCurrentScreenOracle();
	assert.equal(hasStableRecovery(await overwritten.push("\u001b[2J\u001b[HProject recovery\r\nTask: T-008")), false);
	assert.equal(hasStableRecovery(await overwritten.push("\u001b[2J\u001b[HBYZ 本地诊断已开启")), false);

	const visible = createCurrentScreenOracle();
	assert.equal(
		hasStableRecovery(
			await visible.push("\u001b[2J\u001b[HProject recovery\r\nTask: T-008\r\nBYZ 本地诊断已开启"),
		),
		true,
	);

	const fragmented = createCurrentScreenOracle();
	const bytes = Buffer.from("\u001b[2J\u001b[HProject recovery\r\nTask: T-008\r\nBYZ 本地诊断已开启");
	const split = bytes.indexOf(Buffer.from("本")) + 1;
	assert.equal(hasStableRecovery(await pushPtyChunk(fragmented, bytes.subarray(0, split))), false);
	assert.equal(hasStableRecovery(await pushPtyChunk(fragmented, bytes.subarray(split))), true);
});

async function waitForTuiRecovery(command, cwd, env) {
	if (process.platform === "darwin") {
		const session = `byz-packed-${process.pid}-${Date.now()}`;
		let output = "";
		try {
			run("tmux", ["new-session", "-d", "-s", session, "-x", "100", "-y", "30", command], { cwd, env });
			for (let attempt = 0; attempt < 150; attempt += 1) {
				output = run("tmux", ["capture-pane", "-t", session, "-p"], { cwd, env });
				if (hasStableRecovery(output)) return;
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			throw new Error(`Timed out waiting for packed BYZ recovery card. Output:\n${output}`);
		} finally {
			try {
				run("tmux", ["send-keys", "-t", session, "C-c", "C-c"], { cwd, env });
				run("tmux", ["kill-session", "-t", session], { cwd, env });
			} catch {}
		}
	}
	return new Promise((resolve, reject) => {
		const shellCommand = `stty cols 100 rows 30; exec ${JSON.stringify(command)}`;
		const child = spawn("script", ["-qec", shellCommand, "/dev/null"], {
			cwd,
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const screen = createCurrentScreenOracle();
		let output = "";
		let started = false;
		let settled = false;
		const fail = (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			child.kill("SIGTERM");
			reject(error);
		};
		const timeout = setTimeout(() => {
			fail(new Error(`Timed out waiting for packed BYZ TUI startup. Output:\n${output}`));
		}, 15_000);

		const collect = (chunk) => {
			const text = chunk.toString();
			output += text;
			if (settled || started) return;
			void pushPtyChunk(screen, chunk)
				.then((viewport) => {
					if (settled || started || !hasStableRecovery(viewport)) return;
					started = true;
					child.stdin.write("\u0003\u0003");
				})
				.catch(fail);
		};
		child.stdout.on("data", collect);
		child.stderr.on("data", collect);
		child.on("error", fail);
		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (started) {
				resolve();
				return;
			}
			reject(new Error(`Packed BYZ TUI exited with code ${code} before the recovery card. Output:\n${output}`));
		});
	});
}

test("packed BYZ initializes its theme and exports HTML outside the repository", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "byz-packed-runtime-"));
	t.after(() => rm(root, { force: true, recursive: true }));

	const tarballDir = join(root, "tarball");
	const installDir = join(root, "install");
	const homeDir = join(root, "home");
	await Promise.all([
		mkdir(tarballDir, { recursive: true }),
		mkdir(installDir, { recursive: true }),
		mkdir(homeDir, { recursive: true }),
	]);
	const secretMarker = "PACKED-RECOVERY-SECRET-MUST-NOT-SHIP";
	await writeFile(join(homeDir, "private-marker.txt"), secretMarker);

	const packOutput = run(process.execPath, [join(packageDir, "scripts", "pack.mjs"), "--pack-destination", tarballDir], {
		cwd: packageDir,
	});
	const packResult = JSON.parse(packOutput);
	const packed = Array.isArray(packResult) ? packResult[0] : Object.values(packResult)[0];
	const verification = JSON.parse(
		run(process.execPath, [
			join(packageDir, "scripts", "verify-artifact.mjs"),
			"--tarball",
			packed.artifactPath,
			"--receipt",
			packed.receiptPath,
			"--expected-generation",
			packed.generationIdentity,
			"--expected-sha256",
			packed.sha256,
		]),
	);
	t.after(() => rm(verification.snapshotDir, { force: true, recursive: true }));
	const tarballPath = verification.snapshotPath;
	run("npm", ["install", "--prefix", installDir, "--ignore-scripts", "--no-audit", "--no-fund", tarballPath]);

	const isolatedEnv = {
		...process.env,
		HOME: homeDir,
		PI_CODING_AGENT_DIR: join(homeDir, ".byz", "agent"),
	};

	const byzBin = join(installDir, "node_modules", ".bin", "byz");
	for (const workflow of ["cm", "cm-plugin"]) {
		const output = run(byzBin, ["workflow", "check", workflow], { cwd: root, env: isolatedEnv });
		assert.match(output, new RegExp(`${workflow}: check passed`));
	}

	const byzPackageRoot = join(installDir, "node_modules", "@aibyzero", "byz");
	const fixture = join(root, "specs", "trusted-recovery");
	const feature = join(fixture, "1.recovery");
	await mkdir(feature, { recursive: true });
	await Promise.all([
		writeFile(join(fixture, ".cm-specs-status"), JSON.stringify({ status: "approved", features: ["1.recovery"] })),
		writeFile(
			join(fixture, ".cm-status.json"),
			JSON.stringify({ node: "N3", feature: "1.recovery", task: "T-008", state: "running" }),
		),
		writeFile(
			join(fixture, ".cm-run.json"),
			JSON.stringify({ schema_version: 1, run_id: "packed-recovery", workflow: "cm-ai", status: "running" }),
		),
		writeFile(join(feature, "tasks.md"), "- [ ] T-008: packed recovery fixture\n"),
	]);
	const inspectRecovery = join(installDir, "inspect-packed-recovery.mjs");
	await writeFile(
		inspectRecovery,
		`import { createRecoveryExtension } from ${JSON.stringify(new URL(`file://${join(byzPackageRoot, "dist", "recovery", "recovery-extension.js")}`).href)};
function mount(options = {}) {
  const handlers = new Map();
  const commands = new Map();
  createRecoveryExtension(options)({
    on(name, handler) { handlers.set(name, handler); return Object.freeze({ dispose() {} }); },
    registerCommand(name, command) { commands.set(name, command); },
  });
  return { handlers, commands };
}
const notifications = [];
let gitReads = 0;
const trusted = mount({ readGitHead: async () => { gitReads += 1; return "0123456789ab"; } });
trusted.handlers.get("session_start")({}, {
  cwd: ${JSON.stringify(root)},
  reason: "startup",
  isProjectTrusted: () => true,
  readSessionSummary: () => ({ hasHistory: true }),
  ui: { notify(message, level) { notifications.push({ message, level }); } },
});
for (let attempt = 0; attempt < 100 && notifications.length === 0; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
let untrustedReads = 0;
const untrusted = mount({ readEvidence: async () => { untrustedReads += 1; return { state: "absent" }; } });
untrusted.handlers.get("session_start")({}, {
  cwd: ${JSON.stringify(root)},
  reason: "startup",
  isProjectTrusted: () => false,
  readSessionSummary: () => { throw new Error("must not read session"); },
  ui: { notify() { throw new Error("must not notify"); } },
});
await new Promise((resolve) => setImmediate(resolve));
process.stdout.write(JSON.stringify({ notifications, gitReads, untrustedReads }));
`,
	);
	const recovery = JSON.parse(run(process.execPath, [inspectRecovery], { cwd: installDir, env: isolatedEnv }));
	assert.equal(recovery.notifications.length, 1);
	assert.match(recovery.notifications[0].message, /^Project recovery/m);
	assert.match(recovery.notifications[0].message, /Task: T-008/);
	assert.match(recovery.notifications[0].message, /Status: resumable/);
	assert.match(recovery.notifications[0].message, /Session: startup \/ history/);
	assert.equal(recovery.gitReads, 0);
	assert.equal(recovery.untrustedReads, 0);

	const packageFiles = await listFiles(byzPackageRoot);
	assert.equal(packageFiles.some((path) => path.split("/").includes("specs")), false);
	assert.equal(packageFiles.some((path) => path.endsWith("运行日志.jsonl") || /\/(?:\.cm-status|\.cm-run)/u.test(path)), false);
	for (const relativePath of packageFiles) {
		const path = join(byzPackageRoot, relativePath);
		if ((await stat(path)).size > 2_000_000) continue;
		const bytes = await readFile(path);
		if (bytes.includes(0)) continue;
		const text = bytes.toString("utf8");
		assert.doesNotMatch(text, new RegExp(secretMarker, "u"));
		assert.equal(text.includes(root), false, relativePath);
	}
	const installedPackageJson = JSON.parse(await readFile(join(byzPackageRoot, "package.json"), "utf8"));
	const sourcePackageJson = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
	assert.deepEqual(installedPackageJson.dependencies, sourcePackageJson.dependencies);
	for (const lifecycle of ["preinstall", "install", "postinstall", "prepare"]) {
		assert.equal(installedPackageJson.scripts?.[lifecycle], undefined);
	}
	assert.equal(
		packageFiles.some((path) =>
			path
				.toLowerCase()
				.split("/")
				.some((segment) => ["watcher", "watchers", "daemon", "daemons", "test", ".byz-output"].includes(segment)),
		),
		false,
	);

	const agentDir = join(homeDir, ".byz", "agent");
	const hostSkillDir = join(agentDir, "skills", "cm-ai");
	const unrelatedSkillDir = join(agentDir, "skills", "custom-skill");
	const hostPromptDir = join(agentDir, "prompts");
	await Promise.all([
		mkdir(hostSkillDir, { recursive: true }),
		mkdir(unrelatedSkillDir, { recursive: true }),
		mkdir(hostPromptDir, { recursive: true }),
	]);
	await Promise.all([
		writeFile(
			join(hostSkillDir, "SKILL.md"),
			"---\nname: cm-ai\ndescription: Host cm-ai override\n---\nHost cm-ai content\n",
		),
		writeFile(
			join(unrelatedSkillDir, "SKILL.md"),
			"---\nname: custom-skill\ndescription: Unrelated host skill\n---\nCustom content\n",
		),
		writeFile(join(hostPromptDir, "cm-ai.md"), "---\ndescription: Host cm-ai prompt\n---\nHost prompt\n"),
	]);

	const inspectResources = join(installDir, "inspect-byz-resources.mjs");
	await writeFile(
		inspectResources,
		`import { DefaultResourceLoader } from "@aibyzero/byz";
const loader = new DefaultResourceLoader({
  cwd: ${JSON.stringify(root)},
  agentDir: ${JSON.stringify(agentDir)},
  additionalResourcePrecedence: "before",
  additionalSkillPaths: [${JSON.stringify(join(byzPackageRoot, "workflows", "cm", "skills", "cm-ai"))}],
  additionalPromptTemplatePaths: [${JSON.stringify(join(byzPackageRoot, "workflows", "cm", "compat", "claude-commands"))}],
});
await loader.reload();
const skillResult = loader.getSkills();
const promptResult = loader.getPrompts();
const skill = skillResult.skills.find((candidate) => candidate.name === "cm-ai");
const prompt = promptResult.prompts.find((candidate) => candidate.name === "cm-ai");
const skillCollision = skillResult.diagnostics.find(
  (diagnostic) => diagnostic.type === "collision" && diagnostic.collision?.name === "cm-ai",
);
const promptCollision = promptResult.diagnostics.find(
  (diagnostic) => diagnostic.type === "collision" && diagnostic.collision?.name === "cm-ai",
);
process.stdout.write(JSON.stringify({
  skillPath: skill?.filePath,
  promptPath: prompt?.filePath,
  hasCustomSkill: skillResult.skills.some((candidate) => candidate.name === "custom-skill"),
  skillCollision: skillCollision?.collision,
  promptCollision: promptCollision?.collision,
}));
`,
	);
	const resources = JSON.parse(run(process.execPath, [inspectResources], { cwd: installDir, env: isolatedEnv }));
	assert.ok(resources.skillPath.startsWith(byzPackageRoot));
	assert.ok(resources.promptPath.startsWith(byzPackageRoot));
	assert.equal(resources.hasCustomSkill, true);
	assert.ok(resources.skillCollision.winnerPath.startsWith(byzPackageRoot));
	assert.equal(resources.skillCollision.loserPath, join(hostSkillDir, "SKILL.md"));
	assert.ok(resources.promptCollision.winnerPath.startsWith(byzPackageRoot));
	assert.equal(resources.promptCollision.loserPath, join(hostPromptDir, "cm-ai.md"));

	await Promise.all([
		writeFile(join(agentDir, "settings.json"), `${JSON.stringify({ defaultProjectTrust: "always" })}\n`),
		writeFile(join(agentDir, "trust.json"), `${JSON.stringify({ [await realpath(root)]: true })}\n`),
	]);
	const tuiRunner = join(root, "start-byz-tui");
	await writeFile(tuiRunner, `#!/bin/sh\nexec ${JSON.stringify(byzBin)} --offline\n`);
	await chmod(tuiRunner, 0o755);
	const fixtureBeforeStartup = await snapshotFiles(fixture);
	if (["darwin", "linux"].includes(process.platform)) {
		await waitForTuiRecovery(tuiRunner, root, isolatedEnv);
	} else {
		assert.ok(
			(await stat(join(installDir, "node_modules", "@aibyzero", "byz", "dist", "modes", "interactive", "theme", "dark.json"))).isFile(),
		);
	}
	assert.deepEqual(await snapshotFiles(fixture), fixtureBeforeStartup);
	await assert.rejects(stat(join(root, ".git", "hooks")));

	const sessionPath = join(root, "session.jsonl");
	const htmlPath = join(root, "session.html");
	await writeFile(sessionPath, [
		JSON.stringify({
			type: "session",
			version: 3,
			id: "byz-packed-runtime-smoke",
			timestamp: "2026-08-27T00:00:00.000Z",
			cwd: root,
		}),
		JSON.stringify({
			type: "message",
			id: "packed-runtime-message",
			parentId: null,
			timestamp: "2026-08-27T00:00:01.000Z",
			message: {
				role: "user",
				content: [{ type: "text", text: "packed runtime export marker" }],
				timestamp: 1_777_507_201_000,
			},
		}),
		"",
	].join("\n"));
	run(byzBin, ["--export", sessionPath, htmlPath], { cwd: root, env: isolatedEnv });

	assert.ok((await stat(htmlPath)).size > 1_000);
	const html = await readFile(htmlPath, "utf8");
	assert.match(html, /<!DOCTYPE html>/i);
	assert.match(html, /--exportPageBg:/);

	if (process.env.BYZ_RECOVERY_ARTIFACT_RECEIPT) {
		await writeFile(
			process.env.BYZ_RECOVERY_ARTIFACT_RECEIPT,
			`${JSON.stringify(
				{
					schema_version: 1,
					task: "T-008",
					package_version: installedPackageJson.version,
					generation: packed.generationIdentity,
					artifact_sha256: packed.sha256,
					matrix: [
						"isolated-install",
						"trusted-recovery-card",
						"untrusted-zero-read",
						"package-content-privacy",
						"runtime-dependency-parity",
						"workflow-resource-precedence",
						"html-export",
					],
					result: "passed",
				},
				null,
				2,
			)}\n`,
		);
	}
});
