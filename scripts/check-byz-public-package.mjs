#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PRIVATE_WORKFLOW_PACKAGE = "@aibyzero/cm-plugin-workflow";
const PRIVATE_WORKFLOW_PATH = "cm-plugin-workflow";
const PRIVATE_REPOSITORY_IDENTITY = /kingxiaozhe[\\/]cm-plugin-workflow/i;
const FORBIDDEN_PRIVATE_METADATA_KEYS = new Set(["commit", "repo", "repository", "revision", "sha", "source"]);

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function containsForbiddenPrivateMetadata(value, seen = new Set()) {
	if (!value || typeof value !== "object" || seen.has(value)) return false;
	seen.add(value);
	if (Array.isArray(value)) return value.some((item) => containsForbiddenPrivateMetadata(item, seen));
	return Object.entries(value).some(
		([key, child]) =>
			FORBIDDEN_PRIVATE_METADATA_KEYS.has(key.toLowerCase()) || containsForbiddenPrivateMetadata(child, seen),
	);
}

function inspectWorkflowLock(content) {
	let lock;
	try {
		lock = JSON.parse(content);
	} catch {
		return "invalid BYZ workflow lock";
	}
	if (!isRecord(lock) || !isRecord(lock.workflows) || !isRecord(lock.workflows["cm-plugin"])) {
		return "invalid BYZ workflow lock";
	}
	const workflows = lock.workflows;
	for (const [key, workflow] of Object.entries(workflows)) {
		if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) continue;
		if (key === "cm-plugin" || workflow.packageName === PRIVATE_WORKFLOW_PACKAGE) {
			if (containsForbiddenPrivateMetadata(workflow)) return "private workflow source metadata";
		}
	}
	return undefined;
}

async function listFiles(root) {
	const files = [];
	const pending = [root];
	while (pending.length > 0) {
		const directory = pending.pop();
		if (!directory) continue;
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name);
			if (entry.isDirectory()) pending.push(path);
			else if (entry.isFile()) files.push(path);
		}
	}
	return files.sort();
}

export async function findPrivateWorkflowLeaks(packageRoot) {
	const root = resolve(packageRoot);
	const leaks = [];
	for (const path of await listFiles(root)) {
		const packagePath = relative(root, path).replaceAll("\\", "/");
		if (packagePath.split(/[\\/]/).some((segment) => segment.toLowerCase() === PRIVATE_WORKFLOW_PATH)) {
			leaks.push({ file: packagePath, pattern: "private workflow package path" });
			continue;
		}
		const content = (await readFile(path)).toString("utf8");
		if (PRIVATE_REPOSITORY_IDENTITY.test(content)) {
			leaks.push({ file: packagePath, pattern: "private workflow repository identity" });
			continue;
		}
		if (packagePath === "workflows.lock.json") {
			const violation = inspectWorkflowLock(content);
			if (violation) leaks.push({ file: packagePath, pattern: violation });
		}
	}
	return leaks;
}

async function main() {
	const packageRoot = process.argv[2];
	if (!packageRoot || process.argv.length !== 3) {
		throw new Error("Usage: node scripts/check-byz-public-package.mjs <extracted-package-root>");
	}
	const leaks = await findPrivateWorkflowLeaks(packageRoot);
	if (leaks.length > 0) {
		throw new Error(
			`Private workflow source leaked into the BYZ package:\n${leaks
				.map((leak) => `- ${leak.file}: ${leak.pattern}`)
				.join("\n")}`,
		);
	}
	console.log("BYZ public package boundary check passed.");
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
