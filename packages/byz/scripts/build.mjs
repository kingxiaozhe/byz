import { chmod, cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
	acquireBuildLock,
	compileSourceTree,
	isSafeRelativePath,
	publishPackageImage,
	resolveCurrentPackageImage,
	validateBuildManifest,
	validateCompiledOutputPaths,
	validatePackageImage,
	validateRegularTree,
	validateWorkflowBundlePaths,
} from "./build-support.mjs";

const modulePath = fileURLToPath(import.meta.url);
const defaultPackageDir = dirname(dirname(modulePath));
const WORKSPACE_GENERATION_PREFIX = ".byz-output/current/";

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

function toPublishedEntry(value, label) {
	if (typeof value !== "string") throw new Error(`${label} must be a package-relative string.`);
	const explicitRelative = value.startsWith("./");
	const relativeValue = explicitRelative ? value.slice(2) : value;
	if (!relativeValue.startsWith(WORKSPACE_GENERATION_PREFIX)) {
		throw new Error(`${label} must resolve through the current BYZ generation.`);
	}
	const publishedValue = relativeValue.slice(WORKSPACE_GENERATION_PREFIX.length);
	if (!isSafeRelativePath(publishedValue) || !publishedValue.startsWith("dist/")) {
		throw new Error(`${label} must resolve inside the published dist tree.`);
	}
	return explicitRelative ? `./${publishedValue}` : publishedValue;
}

function transformExportTargets(value, label) {
	if (typeof value === "string") return toPublishedEntry(value, label);
	if (Array.isArray(value)) return value.map((entry, index) => transformExportTargets(entry, `${label}[${index}]`));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [key, transformExportTargets(entry, `${label}.${key}`)]),
		);
	}
	throw new Error(`${label} contains an unsupported package export target.`);
}

export function createPublishedPackageJson(workspacePackageJson) {
	const publishedPackageJson = structuredClone(workspacePackageJson);
	if (typeof publishedPackageJson.bin === "string") {
		publishedPackageJson.bin = toPublishedEntry(publishedPackageJson.bin, "package bin");
	} else if (publishedPackageJson.bin && typeof publishedPackageJson.bin === "object") {
		publishedPackageJson.bin = Object.fromEntries(
			Object.entries(publishedPackageJson.bin).map(([name, target]) => [
				name,
				toPublishedEntry(target, `package bin ${name}`),
			]),
		);
	} else {
		throw new Error("BYZ package metadata must declare a bin entry.");
	}
	publishedPackageJson.main = toPublishedEntry(publishedPackageJson.main, "package main");
	publishedPackageJson.types = toPublishedEntry(publishedPackageJson.types, "package types");
	publishedPackageJson.exports = transformExportTargets(publishedPackageJson.exports, "package exports");
	return publishedPackageJson;
}

function collectEntryTargets(packageJson) {
	const targets = [];
	if (typeof packageJson.bin === "string") targets.push(packageJson.bin);
	else targets.push(...Object.values(packageJson.bin ?? {}));
	targets.push(packageJson.main, packageJson.types);
	const visit = (value) => {
		if (typeof value === "string") targets.push(value);
		else if (Array.isArray(value)) value.forEach(visit);
		else if (value && typeof value === "object") Object.values(value).forEach(visit);
	};
	visit(packageJson.exports);
	return targets;
}

export async function validatePublishedPackageMetadata(imageDir, workspacePackageJson, publishedPackageJson) {
	if (JSON.stringify(publishedPackageJson) !== JSON.stringify(createPublishedPackageJson(workspacePackageJson))) {
		throw new Error("Published BYZ package metadata does not match the deterministic workspace transformation.");
	}
	for (const field of [
		"name",
		"version",
		"description",
		"type",
		"files",
		"dependencies",
		"optionalDependencies",
		"engines",
		"license",
	]) {
		if (JSON.stringify(publishedPackageJson[field]) !== JSON.stringify(workspacePackageJson[field])) {
			throw new Error(`Published BYZ package metadata changed protected field: ${field}`);
		}
	}
	const resolvedImage = await realpath(imageDir);
	for (const target of collectEntryTargets(publishedPackageJson)) {
		if (typeof target !== "string" || target.includes(WORKSPACE_GENERATION_PREFIX)) {
			throw new Error("Published BYZ package metadata retained a workspace generation path.");
		}
		const relativeTarget = target.startsWith("./") ? target.slice(2) : target;
		if (!isSafeRelativePath(relativeTarget)) throw new Error(`Unsafe published BYZ package entry: ${target}`);
		const targetPath = join(imageDir, relativeTarget);
		const targetStats = await lstat(targetPath);
		if (targetStats.isSymbolicLink() || !targetStats.isFile()) {
			throw new Error(`Published BYZ package entry is not a regular file: ${target}`);
		}
		const resolvedTarget = await realpath(targetPath);
		const relation = relative(resolvedImage, resolvedTarget);
		if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
			throw new Error(`Published BYZ package entry escaped the image: ${target}`);
		}
	}
}

async function collectTreeFiles(root, label, relativeRoot = "") {
	const files = [];
	for (const entry of await readdir(join(root, relativeRoot), { withFileTypes: true })) {
		const relativePath = relativeRoot ? join(relativeRoot, entry.name) : entry.name;
		if (entry.isSymbolicLink()) throw new Error(`${label} contains a symbolic link: ${relativePath}`);
		if (entry.isDirectory()) files.push(...(await collectTreeFiles(root, label, relativePath)));
		else if (entry.isFile()) files.push(relativePath.split(sep).join("/"));
		else throw new Error(`${label} contains a non-regular entry: ${relativePath}`);
	}
	return files;
}

async function validateCompiledOutput(compiledDir, manifest) {
	validateCompiledOutputPaths(await collectTreeFiles(compiledDir, "Compiled BYZ output"), manifest.runtimeAssets);
}

async function canRemoveGeneration(outputDir, generationDir, publicationState) {
	if (publicationState !== "not-promoted") return false;
	let currentStats;
	try {
		currentStats = await lstat(join(outputDir, "current"));
	} catch (error) {
		return error?.code === "ENOENT";
	}
	if (!currentStats.isSymbolicLink()) return false;
	try {
		const resolvedGeneration = await realpath(generationDir);
		const currentImage = await resolveCurrentPackageImage(outputDir);
		const relation = relative(resolvedGeneration, currentImage);
		return relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation);
	} catch {
		return false;
	}
}

async function resolveBundledPackages(packageDir, byzPackageJson, workflowLock) {
	const packageRequire = createRequire(join(packageDir, "package.json"));
	const workflows = Object.values(workflowLock.workflows).filter(
		(workflow) => workflow.bundled && workflow.bundledPath,
	);
	validateWorkflowBundlePaths(workflows.map((workflow) => workflow.bundledPath));
	const bundledPackages = [];
	for (const workflow of workflows) {
		const workflowPackageDir = await realpath(
			dirname(packageRequire.resolve(`${workflow.packageName}/package.json`)),
		);
		await collectTreeFiles(workflowPackageDir, `Workflow package ${workflow.packageName}`);
		const workflowPackageJson = await readJson(join(workflowPackageDir, "package.json"));
		if (byzPackageJson.devDependencies?.[workflow.packageName] !== workflow.source) {
			throw new Error(`Workflow package source mismatch for ${workflow.packageName}.`);
		}
		if (
			workflowPackageJson.name !== workflow.packageName ||
			workflowPackageJson.version !== workflow.version ||
			workflowPackageJson.license !== workflow.license
		) {
			throw new Error(`Workflow package lock mismatch for ${workflow.packageName}@${workflow.version}.`);
		}
		bundledPackages.push({ packageDir: workflowPackageDir, workflow });
	}
	return bundledPackages;
}

async function copyRuntime(imageDir, manifest, codingAgentDir) {
	const codingAgentDist = join(codingAgentDir, "dist");
	const distDir = join(imageDir, "dist");
	await cp(codingAgentDist, join(distDir, "runtime"), { force: true, recursive: true });
	for (const relativePath of manifest.runtimeAssets) {
		const targetPath = join(distDir, relativePath);
		await mkdir(dirname(targetPath), { recursive: true });
		await cp(join(codingAgentDist, relativePath), targetPath, { force: true });
	}
}

async function copyPackageResources(imageDir, bundledPackages, codingAgentDir) {
	await Promise.all([
		cp(join(codingAgentDir, "docs"), join(imageDir, "docs"), { force: true, recursive: true }),
		cp(join(codingAgentDir, "examples"), join(imageDir, "examples"), { force: true, recursive: true }),
		...bundledPackages.map(({ packageDir: workflowPackageDir, workflow }) =>
			cp(workflowPackageDir, join(imageDir, workflow.bundledPath), { force: true, recursive: true }),
		),
	]);
}

async function copyPackageMetadata(imageDir, manifest, packageDir, publishedPackageJson) {
	for (const path of manifest.packageMetadata) {
		const target = join(imageDir, path);
		await mkdir(dirname(target), { recursive: true });
		if (path === "package.json") {
			await writeFile(target, `${JSON.stringify(publishedPackageJson, null, "\t")}\n`);
		} else {
			await cp(join(packageDir, path), target, { force: true, recursive: true });
		}
	}
}

export async function buildByzPackage({
	packageDir = defaultPackageDir,
	repositoryDir = resolve(packageDir, "..", ".."),
	codingAgentDir = resolve(packageDir, "..", "coding-agent"),
	outputDir,
	compilerPath = join(repositoryDir, "node_modules", ".bin", "tsgo"),
	processIdentityProbe,
} = {}) {
	const resolvedPackageDir = await realpath(packageDir);
	const resolvedRepositoryDir = await realpath(repositoryDir);
	const resolvedCodingAgentDir = await realpath(codingAgentDir);
	const buildOutputDir = join(resolvedPackageDir, ".byz-output");
	if (outputDir !== undefined && resolve(outputDir) !== buildOutputDir) {
		throw new Error(`BYZ output root is fixed at ${buildOutputDir}.`);
	}
	const manifest = await readJson(join(resolvedPackageDir, "build-manifest.json"));
	validateBuildManifest(manifest);
	const [workspacePackageJson, workflowLock] = await Promise.all([
		readJson(join(resolvedPackageDir, "package.json")),
		readJson(join(resolvedPackageDir, "workflows.lock.json")),
	]);
	const publishedPackageJson = createPublishedPackageJson(workspacePackageJson);
	const bundledPackages = await resolveBundledPackages(resolvedPackageDir, workspacePackageJson, workflowLock);
	await Promise.all([
		validateRegularTree(join(resolvedPackageDir, manifest.sourceRoot), "BYZ source tree"),
		validateRegularTree(join(resolvedCodingAgentDir, "dist"), "Pi runtime tree"),
		validateRegularTree(join(resolvedCodingAgentDir, "docs"), "Pi documentation tree"),
		validateRegularTree(join(resolvedCodingAgentDir, "examples"), "Pi examples tree"),
		...manifest.packageMetadata
			.filter((path) => path !== "package.json")
			.map((path) => validateRegularTree(join(resolvedPackageDir, path), `BYZ package metadata ${path}`)),
	]);
	const lockOptions = { packageDir: resolvedPackageDir };
	if (processIdentityProbe) lockOptions.processIdentityProbe = processIdentityProbe;
	const releaseLock = await acquireBuildLock(buildOutputDir, lockOptions);
	let generationDir;
	let compiledDir;
	let imageDir;
	let pointer;
	let publicationState = "not-promoted";
	let failure;
	try {
		generationDir = await mkdtemp(join(releaseLock.generationsRoot, "generation-"));
		compiledDir = join(generationDir, ".compiled");
		imageDir = join(generationDir, "package");
		await mkdir(join(imageDir, "workflows"), { recursive: true });
		await compileSourceTree({
			compilerPath,
			configPath: join(resolvedPackageDir, "tsconfig.build.json"),
			cwd: resolvedRepositoryDir,
			outDir: compiledDir,
		});
		await validateCompiledOutput(compiledDir, manifest);
		await cp(compiledDir, join(imageDir, "dist"), { errorOnExist: true, force: false, recursive: true });
		await rm(compiledDir, { force: true, recursive: true });
		compiledDir = undefined;
		await Promise.all([
			copyRuntime(imageDir, manifest, resolvedCodingAgentDir),
			copyPackageResources(imageDir, bundledPackages, resolvedCodingAgentDir),
			copyPackageMetadata(imageDir, manifest, resolvedPackageDir, publishedPackageJson),
		]);
		await chmod(join(imageDir, "dist", "cli.js"), 0o755);
		await validatePackageImage({ imageDir, manifest });
		await validatePublishedPackageMetadata(imageDir, workspacePackageJson, publishedPackageJson);
		const publication = await publishPackageImage({
			generationDir,
			imageDir,
			outputDir: buildOutputDir,
			lock: releaseLock,
		});
		pointer = publication.pointer;
		publicationState = publication.publicationState;
	} catch (error) {
		if (
			error?.publicationState === "not-promoted" ||
			error?.publicationState === "promoted-confirmed" ||
			error?.publicationState === "promoted-unconfirmed"
		) {
			publicationState = error.publicationState;
			pointer = error.pointer;
		}
		failure = error;
	}
	let cleanupFailure;
	try {
		if (generationDir && (await canRemoveGeneration(buildOutputDir, generationDir, publicationState))) {
			await rm(generationDir, { force: true, recursive: true });
		}
	} catch (error) {
		cleanupFailure = error;
	}
	let releaseFailure;
	let released = false;
	try {
		released = await releaseLock();
	} catch (error) {
		releaseFailure = error;
	}
	if (failure) throw failure;
	if (cleanupFailure) throw cleanupFailure;
	if (releaseFailure) throw releaseFailure;
	if (!released) throw new Error("BYZ build lock ownership was lost before release.");
	return { generationDir, imageDir, pointer, publicationState };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(modulePath)) {
	const result = await buildByzPackage();
	console.log(`Built BYZ package image at ${result.pointer}.`);
}
