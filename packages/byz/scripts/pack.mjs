#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectTarHeaders, sha256File, validateImageAgainstReceipt } from "./artifact.mjs";
import { validatePublishedPackageMetadata } from "./build.mjs";
import { resolveCurrentPackageImage, validateBuildManifest, validatePackageImage } from "./build-support.mjs";

const currentFile = fileURLToPath(import.meta.url);
const defaultPackageDir = dirname(dirname(currentFile));

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

function containsPath(parent, child) {
	const relation = relative(parent, child);
	return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

export function parsePackArguments(args) {
	let destinationBase;
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === "--pack-destination") {
			if (destinationBase !== undefined) throw new Error("--pack-destination may be provided only once.");
			destinationBase = args[++index];
			if (!destinationBase || destinationBase.startsWith("-")) {
				throw new Error("--pack-destination requires a trusted base directory.");
			}
		} else if (argument.startsWith("--pack-destination=")) {
			if (destinationBase !== undefined) throw new Error("--pack-destination may be provided only once.");
			destinationBase = argument.slice("--pack-destination=".length);
			if (!destinationBase) throw new Error("--pack-destination requires a trusted base directory.");
		} else {
			throw new Error(`Unsupported BYZ pack argument: ${argument}`);
		}
	}
	return { destinationBase };
}

export async function validateCurrentByzImage({ packageDir = defaultPackageDir } = {}) {
	const resolvedPackageDir = await realpath(packageDir);
	const outputDir = join(resolvedPackageDir, ".byz-output");
	const imageDir = await resolveCurrentPackageImage(outputDir);
	const [manifest, workspacePackageJson, publishedPackageJson] = await Promise.all([
		readJson(join(imageDir, "build-manifest.json")),
		readJson(join(resolvedPackageDir, "package.json")),
		readJson(join(imageDir, "package.json")),
	]);
	validateBuildManifest(manifest);
	await validatePackageImage({ imageDir, manifest });
	await validatePublishedPackageMetadata(imageDir, workspacePackageJson, publishedPackageJson);
	if ((await resolveCurrentPackageImage(outputDir)) !== imageDir) {
		throw new Error("BYZ current package image changed during validation.");
	}
	return { imageDir, outputDir, packageJson: publishedPackageJson };
}

function parsePackOutput(output) {
	const result = JSON.parse(output);
	if (!Array.isArray(result) || result.length !== 1 || !Array.isArray(result[0]?.files)) {
		throw new Error("npm pack returned an invalid BYZ artifact manifest.");
	}
	return result[0];
}

function npmManifestEntries(npmManifest) {
	if (!Array.isArray(npmManifest?.files)) throw new Error("Invalid npm pack manifest for BYZ.");
	return npmManifest.files
		.map((file) => ({ mode: file.mode, path: file.path, size: file.size, type: "file" }))
		.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

function strippedFileEntries(entries) {
	return entries
		.filter((entry) => entry.type === "file")
		.map(({ mode, path, size, type }) => ({ mode, path, size, type }));
}

export function validateReceiptAgainstNpmManifest(receipt, npmManifest) {
	if (
		receipt.entries.some((entry) => entry.type !== "file") ||
		JSON.stringify(strippedFileEntries(receipt.entries)) !== JSON.stringify(npmManifestEntries(npmManifest))
	) {
		throw new Error("BYZ artifact receipt does not contain the complete npm package manifest.");
	}
}

export function inspectCurrentNpmPackManifest(imageDir, packageDir = imageDir) {
	return parsePackOutput(
		execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts", imageDir], {
			cwd: packageDir,
			encoding: "utf8",
			maxBuffer: 10 * 1024 * 1024,
		}),
	);
}

export async function validateReceiptAgainstCurrentImage(packageDir, receipt) {
	const currentImage = await validateCurrentByzImage({ packageDir });
	validateReceiptAgainstNpmManifest(receipt, inspectCurrentNpmPackManifest(currentImage.imageDir, packageDir));
	await validateImageAgainstReceipt(currentImage.imageDir, receipt);
	const generationIdentity = relative(currentImage.outputDir, currentImage.imageDir).split(sep).join("/");
	const metadataDigest = createHash("sha256")
		.update(await readFile(join(currentImage.imageDir, "package.json")))
		.digest("hex");
	if (receipt.generationIdentity !== generationIdentity || receipt.imageMetadataSha256 !== metadataDigest) {
		throw new Error("BYZ artifact receipt does not match the validated current generation.");
	}
	if ((await resolveCurrentPackageImage(currentImage.outputDir)) !== currentImage.imageDir) {
		throw new Error("BYZ current package image changed during receipt validation.");
	}
	return currentImage;
}

function validateTarAgainstNpmManifest(inspected, npmManifest) {
	if (
		inspected.entries.some((entry) => entry.type !== "file") ||
		JSON.stringify(strippedFileEntries(inspected.entries)) !== JSON.stringify(npmManifestEntries(npmManifest))
	) {
		throw new Error("BYZ tar headers do not match the npm pack manifest.");
	}
}

async function createArtifactReceipt({ imageDir, npmManifest, outputDir, packageJson, tarballPath }) {
	const inspected = await inspectTarHeaders(tarballPath);
	validateTarAgainstNpmManifest(inspected, npmManifest);
	const generationIdentity = relative(outputDir, imageDir).split(sep).join("/");
	if (!/^generations\/[^/]+\/package$/.test(generationIdentity)) {
		throw new Error("BYZ artifact generation identity is invalid.");
	}
	const imageMetadata = await readFile(join(imageDir, "package.json"));
	return {
		entries: inspected.entries,
		generationIdentity,
		imageMetadataSha256: createHash("sha256").update(imageMetadata).digest("hex"),
		package: { name: packageJson.name, version: packageJson.version },
		schemaVersion: 1,
		tarball: {
			integrity: npmManifest.integrity,
			sha256: await sha256File(tarballPath),
			size: npmManifest.size,
		},
		totalBytes: inspected.totalBytes,
	};
}

export async function packCurrentByzImage({
	args = [],
	onArtifactDirectoryReady,
	packageDir = defaultPackageDir,
} = {}) {
	const { destinationBase } = parsePackArguments(args);
	const { imageDir, outputDir, packageJson } = await validateCurrentByzImage({ packageDir });
	const resolvedBase = await realpath(resolve(packageDir, destinationBase ?? tmpdir()));
	const resolvedOutput = await realpath(outputDir);
	if (containsPath(resolvedOutput, resolvedBase)) {
		throw new Error("BYZ artifact base directory must be outside the immutable output root.");
	}
	const artifactDir = await mkdtemp(join(resolvedBase, "byz-artifact-"));
	try {
		const artifactStats = await lstat(artifactDir);
		const resolvedArtifactDir = await realpath(artifactDir);
		if (
			artifactStats.isSymbolicLink() ||
			!artifactStats.isDirectory() ||
			containsPath(resolvedOutput, resolvedArtifactDir)
		) {
			throw new Error("BYZ artifact directory must be a private real directory outside the output root.");
		}
		await onArtifactDirectoryReady?.(resolvedArtifactDir);
		const npmOutput = execFileSync(
			"npm",
			["pack", "--json", "--ignore-scripts", "--pack-destination", resolvedArtifactDir, imageDir],
			{
				cwd: packageDir,
				encoding: "utf8",
				maxBuffer: 10 * 1024 * 1024,
			},
		);
		const npmManifest = parsePackOutput(npmOutput);
		if (
			typeof npmManifest.filename !== "string" ||
			npmManifest.filename.includes("/") ||
			npmManifest.filename.includes("\\")
		) {
			throw new Error("npm pack returned an unsafe BYZ artifact filename.");
		}
		const artifactPath = join(resolvedArtifactDir, npmManifest.filename);
		await chmod(artifactPath, 0o600);
		const receipt = await createArtifactReceipt({
			imageDir,
			npmManifest,
			outputDir,
			packageJson,
			tarballPath: artifactPath,
		});
		const receiptPath = join(resolvedArtifactDir, "artifact-receipt.json");
		await writeFile(receiptPath, `${JSON.stringify(receipt, null, "\t")}\n`, { flag: "wx", mode: 0o600 });
		const identity = { generationIdentity: receipt.generationIdentity, sha256: receipt.tarball.sha256 };
		const output = `${JSON.stringify([{ ...npmManifest, artifactPath, receiptPath, ...identity }], null, 2)}\n`;
		return { artifactPath, imageDir, output, packageJson, receiptPath, ...identity };
	} catch (error) {
		await rm(artifactDir, { force: true, recursive: true });
		throw error;
	}
}

async function main() {
	const result = await packCurrentByzImage({ args: process.argv.slice(2) });
	process.stdout.write(result.output);
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
