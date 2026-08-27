#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const WORKFLOW_IDENTITIES = {
	cm: "@aibyzero/cm-workflow",
	"cm-plugin": "@aibyzero/cm-plugin-workflow",
};

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeRelativePath(value) {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		!isAbsolute(value) &&
		!value.replaceAll("\\", "/").split("/").includes("..")
	);
}

function containsPath(parent, child) {
	const relation = relative(parent, child);
	return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

async function isFile(path) {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

export async function findPublicPackageViolations(packageRoot) {
	const root = resolve(packageRoot);
	let lock;
	try {
		lock = JSON.parse(await readFile(resolve(root, "workflows.lock.json"), "utf8"));
	} catch {
		return [{ file: "workflows.lock.json", pattern: "invalid BYZ workflow lock" }];
	}
	if (lock.schemaVersion !== 1 || !isRecord(lock.workflows)) {
		return [{ file: "workflows.lock.json", pattern: "invalid BYZ workflow lock" }];
	}

	const records = [];
	for (const [id, packageName] of Object.entries(WORKFLOW_IDENTITIES)) {
		const workflow = lock.workflows[id];
		if (!isRecord(workflow) || workflow.packageName !== packageName) {
			return [{ file: "workflows.lock.json", pattern: "invalid BYZ workflow lock" }];
		}
		if (workflow.bundled !== true) {
			return [{ file: "workflows.lock.json", pattern: "workflow must be bundled" }];
		}
		if (typeof workflow.source !== "string" || !/#[0-9a-f]{40}$/i.test(workflow.source)) {
			return [{ file: "workflows.lock.json", pattern: "workflow source is not pinned" }];
		}
		if (!isSafeRelativePath(workflow.bundledPath) || !Array.isArray(workflow.requiredFiles)) {
			return [{ file: "workflows.lock.json", pattern: "invalid BYZ workflow lock" }];
		}
		const bundleRoot = resolve(root, workflow.bundledPath);
		if (!containsPath(root, bundleRoot)) {
			return [{ file: "workflows.lock.json", pattern: "invalid BYZ workflow lock" }];
		}
		records.push({ bundleRoot, id, workflow });
	}

	for (let index = 0; index < records.length; index++) {
		for (let otherIndex = index + 1; otherIndex < records.length; otherIndex++) {
			if (
				containsPath(records[index].bundleRoot, records[otherIndex].bundleRoot) ||
				containsPath(records[otherIndex].bundleRoot, records[index].bundleRoot)
			) {
				return [{ file: "workflows.lock.json", pattern: "workflow bundle roots overlap" }];
			}
		}
	}

	for (const { bundleRoot, id, workflow } of records) {
		for (const requiredFile of workflow.requiredFiles) {
			if (!isSafeRelativePath(requiredFile)) {
				return [{ file: "workflows.lock.json", pattern: "invalid BYZ workflow lock" }];
			}
			const target = resolve(bundleRoot, requiredFile);
			if (!containsPath(bundleRoot, target) || !(await isFile(target))) {
				return [{ file: `${workflow.bundledPath}/${requiredFile}`, pattern: "missing bundled workflow file", workflow: id }];
			}
		}
	}

	return [];
}

async function main() {
	const packageRoot = process.argv[2];
	if (!packageRoot || process.argv.length !== 3) {
		throw new Error("Usage: node scripts/check-byz-public-package.mjs <extracted-package-root>");
	}
	const violations = await findPublicPackageViolations(packageRoot);
	if (violations.length > 0) {
		throw new Error(
			`Invalid BYZ public package workflow contract:\n${violations
				.map((violation) => `- ${violation.file}: ${violation.pattern}`)
				.join("\n")}`,
		);
	}
	console.log("BYZ public package workflow contract passed.");
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
