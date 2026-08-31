import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageDir = fileURLToPath(new URL("../packages/byz/", import.meta.url));

function run(command, args, options = {}) {
	return execFileSync(command, args, {
		encoding: "utf8",
		maxBuffer: 10 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
		...options,
	});
}

function waitForTuiStartup(command, cwd, env) {
	return new Promise((resolve, reject) => {
		const child = spawn("script", ["-qec", command, "/dev/null"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
		let output = "";
		let started = false;
		const timeout = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new Error(`Timed out waiting for packed BYZ TUI startup. Output:\n${output}`));
		}, 15_000);

		const collect = (chunk) => {
			output += chunk.toString();
			if (!started && output.includes("No models available")) {
				started = true;
				child.stdin.write("\u0003\u0003");
			}
		};
		child.stdout.on("data", collect);
		child.stderr.on("data", collect);
		child.on("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timeout);
			if (started) {
				resolve();
				return;
			}
			reject(new Error(`Packed BYZ TUI exited with code ${code} before startup. Output:\n${output}`));
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

	const tuiRunner = join(root, "start-byz-tui");
	await writeFile(tuiRunner, `#!/bin/sh\nexec ${JSON.stringify(byzBin)} --offline\n`);
	await chmod(tuiRunner, 0o755);
	if (process.platform === "linux") {
		await waitForTuiStartup(tuiRunner, root, isolatedEnv);
	} else {
		assert.ok(
			(await stat(join(installDir, "node_modules", "@aibyzero", "byz", "dist", "modes", "interactive", "theme", "dark.json"))).isFile(),
		);
	}

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
});
