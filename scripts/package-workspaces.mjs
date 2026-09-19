import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// `.byz-output` holds built package images whose package.json copies are not workspace sources.
const SKIPPED_DIRECTORIES = new Set([".byz-output", "dist", "node_modules"]);

// Packages that ship on their own version line instead of the shared lockstep release.
// BYZ bundles a pinned Pi commit (packages/byz/upstream.json) rather than depending on the Pi
// packages, so lockstep versioning and the Pi release path do not apply to it.
export const INDEPENDENT_PACKAGES = new Set(["@aibyzero/byz"]);

export function findPackageDirectories(root = "packages") {
	const packageDirectories = [];

	function visit(directory) {
		if (existsSync(join(directory, "package.json"))) {
			packageDirectories.push(directory);
		}

		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (!entry.isDirectory() || SKIPPED_DIRECTORIES.has(entry.name)) {
				continue;
			}
			visit(join(directory, entry.name));
		}
	}

	visit(root);
	return packageDirectories.sort();
}

export function isIndependentPackageDirectory(directory) {
	try {
		return INDEPENDENT_PACKAGES.has(JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).name);
	} catch {
		return false;
	}
}

export function findLockstepPackageDirectories(root = "packages") {
	return findPackageDirectories(root).filter((directory) => !isIndependentPackageDirectory(directory));
}
