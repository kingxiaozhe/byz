import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const packageDir = new URL("../packages/byz/", import.meta.url);

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
			if (!started && output.includes("byz v")) {
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

	const packOutput = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", tarballDir], {
		cwd: packageDir,
	});
	const packResult = JSON.parse(packOutput);
	const packed = Array.isArray(packResult) ? packResult[0] : Object.values(packResult)[0];
	const tarballPath = join(tarballDir, packed.filename);
	run("npm", ["install", "--prefix", installDir, "--ignore-scripts", "--no-audit", "--no-fund", tarballPath]);

	const isolatedEnv = {
		...process.env,
		HOME: homeDir,
		PI_CODING_AGENT_DIR: join(homeDir, ".byz", "agent"),
	};

	const byzBin = join(installDir, "node_modules", ".bin", "byz");
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
