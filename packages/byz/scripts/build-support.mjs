import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const EXPECTED_GENERATED_ROOTS = ["dist", "docs", "examples", "workflows"];
const OWNER_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const ACTIVE_BUILD_LOCKS = new Map();

function isOutside(root, candidate) {
	const relation = relative(root, candidate);
	return relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation);
}

export function isSafeRelativePath(path) {
	return (
		typeof path === "string" &&
		path.length > 0 &&
		!isAbsolute(path) &&
		!path.replaceAll("\\", "/").split("/").includes("..")
	);
}

export function portablePackagePathKey(path, label = "Package path") {
	if (!isSafeRelativePath(path)) throw new Error(`${label} is not portable: ${String(path)}`);
	const normalizedPath = path.replaceAll("\\", "/");
	if (normalizedPath !== posix.normalize(normalizedPath) || normalizedPath.endsWith("/")) {
		throw new Error(`${label} is not portable: ${path}`);
	}
	const keys = [];
	for (const segment of normalizedPath.split("/")) {
		const normalized = segment.normalize("NFKC");
		if (
			!segment ||
			normalized !== segment ||
			!/^[A-Za-z0-9._-]+$/.test(normalized) ||
			/[. ]$/.test(normalized) ||
			WINDOWS_RESERVED_SEGMENT.test(normalized)
		) {
			throw new Error(`${label} is not portable: ${path}`);
		}
		keys.push(normalized.toLowerCase());
	}
	return keys.join("/");
}

function portableWorkflowKey(path) {
	return portablePackagePathKey(path, "Workflow bundle path");
}

function hasPortablePathOverlap(entries) {
	const keys = new Set();
	for (const entry of entries) {
		if (keys.has(entry.key)) return true;
		keys.add(entry.key);
	}
	for (const key of keys) {
		let separatorIndex = key.indexOf("/");
		while (separatorIndex !== -1) {
			if (keys.has(key.slice(0, separatorIndex))) return true;
			separatorIndex = key.indexOf("/", separatorIndex + 1);
		}
	}
	return false;
}

function hasUniquePortablePaths(paths, label) {
	try {
		return !hasPortablePathOverlap(paths.map((path) => ({ key: portablePackagePathKey(path, label), path })));
	} catch {
		return false;
	}
}

function overlapsPortableRoots(paths, roots, label) {
	try {
		const pathKeys = paths.map((path) => portablePackagePathKey(path, label));
		const rootKeys = roots.map((path) => portablePackagePathKey(path, "Generated package root"));
		return pathKeys.some((pathKey) =>
			rootKeys.some(
				(rootKey) => pathKey === rootKey || pathKey.startsWith(`${rootKey}/`) || rootKey.startsWith(`${pathKey}/`),
			),
		);
	} catch {
		return true;
	}
}

export function validateCompiledOutputPaths(compiledPaths, runtimeAssets) {
	if (!Array.isArray(compiledPaths) || !Array.isArray(runtimeAssets)) {
		throw new Error("Compiled output paths and runtime assets must be arrays.");
	}
	const compiledEntries = compiledPaths.map((path) => ({
		key: portablePackagePathKey(path, "Compiled BYZ output path"),
		path,
	}));
	if (hasPortablePathOverlap([...compiledEntries])) {
		throw new Error("Compiled BYZ output contains overlapping portable paths.");
	}
	const runtimeTreeKey = portablePackagePathKey("runtime", "Reserved Pi runtime tree");
	const runtimeAssetEntries = runtimeAssets.map((path) => ({
		key: portablePackagePathKey(path, "Reserved Pi runtime asset path"),
		path,
	}));
	if (hasPortablePathOverlap([...runtimeAssetEntries])) {
		throw new Error("Pi runtime assets contain overlapping portable paths.");
	}
	for (const compiled of compiledEntries) {
		if (compiled.key === runtimeTreeKey || compiled.key.startsWith(`${runtimeTreeKey}/`)) {
			throw new Error(`Compiled BYZ output overlaps the reserved Pi runtime tree: ${compiled.path}`);
		}
		for (const asset of runtimeAssetEntries) {
			if (
				compiled.key === asset.key ||
				compiled.key.startsWith(`${asset.key}/`) ||
				asset.key.startsWith(`${compiled.key}/`)
			) {
				throw new Error(
					`Compiled BYZ output portable path conflicts with reserved Pi runtime asset ${asset.path}: ${compiled.path}`,
				);
			}
		}
	}
}

export function validateWorkflowBundlePath(path) {
	if (!isSafeRelativePath(path)) throw new Error(`Unsafe workflow bundle path: ${String(path)}`);
	const normalized = path.replaceAll("\\", "/");
	if (
		normalized !== posix.normalize(normalized) ||
		normalized === "workflows" ||
		!normalized.startsWith("workflows/") ||
		normalized.endsWith("/")
	) {
		throw new Error(`Unsafe workflow bundle path: ${String(path)}`);
	}
	portableWorkflowKey(normalized);
	return normalized;
}

export function validateWorkflowBundlePaths(paths) {
	if (!Array.isArray(paths)) throw new Error("Workflow bundle paths must be an array.");
	const destinations = paths.map((path) => {
		const normalized = validateWorkflowBundlePath(path);
		return { key: portableWorkflowKey(normalized), normalized };
	});
	destinations.sort((left, right) => left.key.localeCompare(right.key));
	for (let index = 0; index < destinations.length; index++) {
		for (let otherIndex = index + 1; otherIndex < destinations.length; otherIndex++) {
			const current = destinations[index];
			const other = destinations[otherIndex];
			if (current.key === other.key || other.key.startsWith(`${current.key}/`)) {
				throw new Error(`Overlapping workflow bundle paths: ${current.normalized} and ${other.normalized}`);
			}
		}
	}
	return destinations.map((destination) => destination.normalized).sort();
}

function hasUniqueSafePaths(paths) {
	return Array.isArray(paths) && new Set(paths).size === paths.length && paths.every(isSafeRelativePath);
}

export function validateBuildManifest(manifest) {
	if (
		manifest?.schemaVersion !== 1 ||
		manifest.sourceRoot !== "src" ||
		!hasUniqueSafePaths(manifest.generatedRoots) ||
		!hasUniqueSafePaths(manifest.runtimeAssets) ||
		!hasUniquePortablePaths(manifest.runtimeAssets, "Reserved Pi runtime asset path") ||
		overlapsPortableRoots(manifest.runtimeAssets, ["runtime"], "Reserved Pi runtime asset path") ||
		!hasUniqueSafePaths(manifest.packageMetadata) ||
		!hasUniquePortablePaths(manifest.packageMetadata, "Package metadata path") ||
		overlapsPortableRoots(manifest.packageMetadata, manifest.generatedRoots, "Package metadata path") ||
		manifest.generatedRoots.some((root) => root.includes("/") || root.includes("\\")) ||
		manifest.packageMetadata.some((path) => path.includes("/") || path.includes("\\")) ||
		EXPECTED_GENERATED_ROOTS.some((root) => !manifest.generatedRoots.includes(root)) ||
		manifest.generatedRoots.length !== EXPECTED_GENERATED_ROOTS.length ||
		!manifest.packageMetadata.includes("package.json")
	) {
		throw new Error("Invalid BYZ build manifest.");
	}
}

async function pathExists(path) {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (error?.code === "ENOENT") return false;
		throw error;
	}
}

async function inspectRealDirectory(path, allowedRoot, label) {
	try {
		await mkdir(path, { mode: 0o700 });
	} catch (error) {
		if (error?.code !== "EEXIST") throw error;
	}
	const stats = await lstat(path);
	if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`${label} must be a real directory.`);
	const resolved = await realpath(path);
	if (isOutside(allowedRoot, resolved)) throw new Error(`${label} escaped its allowed root.`);
	return { dev: stats.dev, ino: stats.ino, path: resolved };
}

async function assertDirectoryBoundary(boundary, label) {
	const stats = await lstat(boundary.path);
	if (stats.isSymbolicLink() || !stats.isDirectory() || stats.dev !== boundary.dev || stats.ino !== boundary.ino) {
		throw new Error(`${label} changed during the BYZ build.`);
	}
}

export async function ensureSafeOutputRoot(outputDir, packageDir = dirname(outputDir)) {
	const packageRoot = await realpath(packageDir);
	const outputParent = await realpath(dirname(outputDir));
	if (isOutside(packageRoot, outputParent)) throw new Error("BYZ output parent escaped the package root.");
	return (await inspectRealDirectory(outputDir, packageRoot, "BYZ output root")).path;
}

export async function validateRegularTree(path, label) {
	const stats = await lstat(path);
	if (stats.isSymbolicLink()) throw new Error(`${label} contains a symbolic link: ${path}`);
	if (stats.isFile()) return;
	if (!stats.isDirectory()) throw new Error(`${label} contains a non-regular entry: ${path}`);
	for (const entry of await readdir(path)) await validateRegularTree(join(path, entry), label);
}

export async function validatePackageImage({ imageDir, manifest }) {
	await validateRegularTree(imageDir, "Package image");
	for (const root of manifest.generatedRoots) {
		if (!(await pathExists(join(imageDir, root)))) {
			throw new Error(`Package image is missing generated root: ${root}`);
		}
	}
	for (const path of manifest.packageMetadata) {
		if (!(await pathExists(join(imageDir, path)))) throw new Error(`Package image is missing metadata: ${path}`);
	}
	for (const path of manifest.runtimeAssets) {
		if (!(await pathExists(join(imageDir, "dist", path)))) {
			throw new Error(`Package image is missing runtime asset: ${path}`);
		}
	}
}

async function readFileNoFollow(path, label) {
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const stats = await handle.stat();
		if (!stats.isFile()) throw new Error(`${label} must be a regular file.`);
		return await handle.readFile("utf8");
	} finally {
		await handle?.close();
	}
}

async function readLinuxProcessStartId(pid) {
	try {
		const stat = await readFile(`/proc/${pid}/stat`, "utf8");
		const commandEnd = stat.lastIndexOf(")");
		if (commandEnd < 0) return { state: "unknown" };
		const fields = stat
			.slice(commandEnd + 2)
			.trim()
			.split(/\s+/);
		const startTicks = fields[19];
		if (!/^\d+$/.test(startTicks ?? "")) return { state: "unknown" };
		return { processStartId: `linux:${startTicks}`, state: "found" };
	} catch (error) {
		if (error?.code === "ENOENT" || error?.code === "ESRCH") return { state: "absent" };
		return { state: "unknown" };
	}
}

async function processExists(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (error?.code === "ESRCH") return false;
		return error?.code === "EPERM";
	}
}

async function readDarwinProcessStartId(pid) {
	try {
		const { stdout } = await execFileAsync("/bin/ps", ["-o", "lstart=", "-o", "command=", "-p", String(pid)], {
			encoding: "utf8",
			env: { ...process.env, LANG: "C", LC_ALL: "C", TZ: "UTC" },
		});
		const identity = stdout.trim().replace(/\s+/g, " ");
		if (!identity) return (await processExists(pid)) ? { state: "unknown" } : { state: "absent" };
		return { processStartId: `darwin:${identity}`, state: "found" };
	} catch {
		return (await processExists(pid)) ? { state: "unknown" } : { state: "absent" };
	}
}

async function readWindowsProcessStartId(pid) {
	try {
		const script = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`;
		const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
			encoding: "utf8",
		});
		const start = stdout.trim();
		if (!/^\d+$/.test(start)) return { state: "unknown" };
		return { processStartId: `win32:${start}`, state: "found" };
	} catch {
		return (await processExists(pid)) ? { state: "unknown" } : { state: "absent" };
	}
}

async function readSystemProcessStartId(pid) {
	if (!Number.isSafeInteger(pid) || pid <= 0) return { state: "unknown" };
	if (process.platform === "linux") return readLinuxProcessStartId(pid);
	if (process.platform === "darwin") return readDarwinProcessStartId(pid);
	if (process.platform === "win32") return readWindowsProcessStartId(pid);
	return { state: "unknown" };
}

export function createSystemProcessIdentityProbe() {
	return {
		async current() {
			const result = await readSystemProcessStartId(process.pid);
			if (result.state !== "found") throw new Error("Could not determine the current BYZ build process identity.");
			return { pid: process.pid, processStartId: result.processStartId };
		},
		async inspect(pid, expectedStartId) {
			const result = await readSystemProcessStartId(pid);
			if (result.state === "absent") return "absent";
			if (result.state !== "found") return "unknown";
			return result.processStartId === expectedStartId ? "same" : "different";
		},
	};
}

function validateLockOwner(owner, expectedToken) {
	if (
		owner?.schemaVersion !== 4 ||
		!OWNER_TOKEN_PATTERN.test(owner.ownerToken) ||
		(expectedToken && owner.ownerToken !== expectedToken) ||
		!Number.isSafeInteger(owner.pid) ||
		owner.pid <= 0 ||
		typeof owner.processStartId !== "string" ||
		owner.processStartId.length === 0 ||
		owner.status !== "claiming"
	) {
		throw new Error("Invalid BYZ build lock owner metadata.");
	}
	return owner;
}

async function readLockOwner(lockRootBoundary, ownerToken) {
	if (!OWNER_TOKEN_PATTERN.test(ownerToken)) throw new Error("Invalid BYZ build lock owner token.");
	await assertDirectoryBoundary(lockRootBoundary, "BYZ build lock root");
	const ownerDir = join(lockRootBoundary.path, ownerToken);
	const stats = await lstat(ownerDir);
	if (stats.isSymbolicLink() || !stats.isDirectory())
		throw new Error("BYZ build owner lock must be a real directory.");
	const owner = validateLockOwner(
		JSON.parse(await readFileNoFollow(join(ownerDir, "owner.json"), "BYZ build lock owner")),
		ownerToken,
	);
	try {
		const activeStats = await lstat(join(ownerDir, "active"), { bigint: true });
		if (activeStats.isSymbolicLink() || !activeStats.isFile()) throw new Error("BYZ active lock marker is invalid.");
		return { ...owner, activationOrder: activeStats.mtimeNs, status: "active" };
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
		return owner;
	}
}

async function readLockOwners(lockRootBoundary) {
	await assertDirectoryBoundary(lockRootBoundary, "BYZ build lock root");
	const entries = await readdir(lockRootBoundary.path, { withFileTypes: true });
	const owners = [];
	for (const entry of entries) {
		if (!OWNER_TOKEN_PATTERN.test(entry.name)) continue;
		if (!entry.isDirectory() || entry.isSymbolicLink())
			throw new Error("BYZ build owner lock must be a real directory.");
		try {
			owners.push(await readLockOwner(lockRootBoundary, entry.name));
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}
	}
	return owners;
}

async function writeOwnerState(outputBoundary, ownerDir, owner) {
	await assertDirectoryBoundary(outputBoundary, "BYZ output root");
	const stats = await lstat(ownerDir);
	if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("BYZ build owner directory changed.");
	const temporaryPath = join(ownerDir, `.owner-${randomUUID()}.json`);
	await writeFile(temporaryPath, `${JSON.stringify(owner)}\n`, { flag: "wx", mode: 0o600 });
	await rename(temporaryPath, join(ownerDir, "owner.json"));
}

async function activateOwner(outputBoundary, ownerDir, ownerToken) {
	await assertDirectoryBoundary(outputBoundary, "BYZ output root");
	await writeFile(join(ownerDir, "active"), `${ownerToken}\n`, { flag: "wx", mode: 0o600 });
}

async function createOwnerLock(outputBoundary, lockRootBoundary, owner) {
	await assertDirectoryBoundary(outputBoundary, "BYZ output root");
	await assertDirectoryBoundary(lockRootBoundary, "BYZ build lock root");
	const ownerDir = join(lockRootBoundary.path, owner.ownerToken);
	const candidateDir = join(lockRootBoundary.path, `.candidate-${owner.ownerToken}`);
	await mkdir(candidateDir, { mode: 0o700 });
	try {
		await writeOwnerState(outputBoundary, candidateDir, owner);
		await rename(candidateDir, ownerDir);
	} finally {
		await rm(candidateDir, { force: true, recursive: true });
	}
	return ownerDir;
}

function yieldToContenders() {
	return new Promise((resolveYield) => setImmediate(resolveYield));
}

function compareActiveOwners(left, right) {
	if (left.activationOrder === right.activationOrder) return left.ownerToken.localeCompare(right.ownerToken);
	return left.activationOrder < right.activationOrder ? -1 : 1;
}

async function inspectOwnerStates(lockRootBoundary, processIdentityProbe) {
	const owners = await readLockOwners(lockRootBoundary);
	return Promise.all(
		owners.map(async (owner) => ({
			observation: await processIdentityProbe.inspect(owner.pid, owner.processStartId),
			owner,
		})),
	);
}

function assertNoUnknownCompetingOwner(states, ownerToken) {
	const unknown = states.find((state) => state.owner.ownerToken !== ownerToken && state.observation === "unknown");
	if (unknown) throw new Error(`Cannot safely determine whether BYZ build pid ${unknown.owner.pid} is still active.`);
}

export async function acquireBuildLock(
	outputDir,
	{ packageDir = dirname(outputDir), processIdentityProbe = createSystemProcessIdentityProbe() } = {},
) {
	const packageRoot = await realpath(packageDir);
	const outputRoot = await ensureSafeOutputRoot(outputDir, packageDir);
	const outputBoundary = await inspectRealDirectory(outputRoot, packageRoot, "BYZ output root");
	const generationsBoundary = await inspectRealDirectory(
		join(outputRoot, "generations"),
		outputRoot,
		"BYZ generations root",
	);
	const lockRootBoundary = await inspectRealDirectory(
		join(outputRoot, ".build-locks-v3"),
		outputRoot,
		"BYZ build lock root",
	);
	const identity = await processIdentityProbe.current();
	if (
		!Number.isSafeInteger(identity?.pid) ||
		identity.pid <= 0 ||
		typeof identity.processStartId !== "string" ||
		identity.processStartId.length === 0
	) {
		throw new Error("Invalid current BYZ build process identity.");
	}
	const owner = {
		schemaVersion: 4,
		ownerToken: randomUUID(),
		pid: identity.pid,
		processStartId: identity.processStartId,
		status: "claiming",
	};
	const ownerDir = await createOwnerLock(outputBoundary, lockRootBoundary, owner);
	let acquired = false;
	try {
		await yieldToContenders();
		let states = await inspectOwnerStates(lockRootBoundary, processIdentityProbe);
		assertNoUnknownCompetingOwner(states, owner.ownerToken);
		const active = states.find(
			(state) =>
				state.owner.ownerToken !== owner.ownerToken &&
				state.owner.status === "active" &&
				state.observation === "same",
		);
		if (active) throw new Error(`Another BYZ build is active (pid ${active.owner.pid}).`);
		const claiming = states
			.filter((state) => state.owner.status === "claiming" && state.observation === "same")
			.map((state) => state.owner)
			.sort((left, right) => left.ownerToken.localeCompare(right.ownerToken));
		if (claiming[0]?.ownerToken !== owner.ownerToken) {
			throw new Error(`Another BYZ build claim won (${claiming[0]?.ownerToken ?? "unknown"}).`);
		}
		await activateOwner(outputBoundary, ownerDir, owner.ownerToken);
		await yieldToContenders();
		states = await inspectOwnerStates(lockRootBoundary, processIdentityProbe);
		assertNoUnknownCompetingOwner(states, owner.ownerToken);
		const activeOwners = states
			.filter((state) => state.owner.status === "active" && state.observation === "same")
			.map((state) => state.owner)
			.sort(compareActiveOwners);
		if (activeOwners[0]?.ownerToken !== owner.ownerToken) {
			throw new Error(`Another BYZ build claim became active (${activeOwners[0]?.ownerToken ?? "unknown"}).`);
		}
		acquired = true;
	} finally {
		if (!acquired) await rm(ownerDir, { force: true, recursive: true });
	}

	const lockKey = resolve(outputDir);
	const assertOwner = async () => {
		await assertDirectoryBoundary(outputBoundary, "BYZ output root");
		await assertDirectoryBoundary(generationsBoundary, "BYZ generations root");
		await assertDirectoryBoundary(lockRootBoundary, "BYZ build lock root");
		const currentOwner = await readLockOwner(lockRootBoundary, owner.ownerToken);
		if (currentOwner.status !== "active") throw new Error("BYZ build lock ownership was lost.");
		const processState = await processIdentityProbe.inspect(owner.pid, owner.processStartId);
		if (processState !== "same") throw new Error("BYZ build process identity changed while holding the lock.");
		const states = await inspectOwnerStates(lockRootBoundary, processIdentityProbe);
		assertNoUnknownCompetingOwner(states, owner.ownerToken);
		const activeOwners = states
			.filter((state) => state.owner.status === "active" && state.observation === "same")
			.map((state) => state.owner)
			.sort(compareActiveOwners);
		if (activeOwners[0]?.ownerToken !== owner.ownerToken) {
			throw new Error(`BYZ build lock ownership was lost to ${activeOwners[0]?.ownerToken ?? "unknown"}.`);
		}
	};
	const runExclusive = async (operation) => {
		await assertOwner();
		const result = await operation(outputBoundary.path);
		await assertOwner();
		return result;
	};
	const release = async () => {
		let owned = true;
		try {
			await assertOwner();
		} catch {
			owned = false;
		}
		try {
			await rm(ownerDir, { force: true, recursive: true });
		} catch {
			owned = false;
		}
		if (ACTIVE_BUILD_LOCKS.get(lockKey) === release) ACTIVE_BUILD_LOCKS.delete(lockKey);
		return owned;
	};
	release.assertOwner = assertOwner;
	release.runExclusive = runExclusive;
	release.ownerToken = owner.ownerToken;
	release.outputRoot = outputBoundary.path;
	release.generationsRoot = generationsBoundary.path;
	ACTIVE_BUILD_LOCKS.set(lockKey, release);
	return release;
}

export async function compileSourceTree({ compilerPath, configPath, cwd, outDir }) {
	await execFileAsync(compilerPath, ["-p", configPath, "--outDir", outDir], { cwd });
}

export class PackagePublicationError extends Error {
	constructor(cause, publicationState, pointer) {
		super(`${cause instanceof Error ? cause.message : String(cause)} (publication state: ${publicationState})`, {
			cause,
		});
		this.name = "PackagePublicationError";
		this.pointer = pointer;
		this.publicationState = publicationState;
	}
}

export async function publishPackageImage({ generationDir, imageDir, outputDir, lock }) {
	let pointer;
	let publicationState = "not-promoted";
	try {
		const activeLock = lock ?? ACTIVE_BUILD_LOCKS.get(resolve(outputDir));
		if (!activeLock) throw new Error("Publishing a BYZ package image requires the active build lock.");
		const resolvedGeneration = await realpath(generationDir);
		const resolvedImage = await realpath(imageDir);
		if (isOutside(resolvedGeneration, resolvedImage)) throw new Error("Package image escaped its generation.");
		if (isOutside(activeLock.generationsRoot, resolvedGeneration)) {
			throw new Error("Package generation escaped the locked BYZ generations root.");
		}
		const promote = async (lockedOutputRoot) => {
			pointer = join(lockedOutputRoot, "current");
			const temporaryPointer = join(lockedOutputRoot, `.current-${randomUUID()}`);
			try {
				await symlink(relative(lockedOutputRoot, resolvedImage), temporaryPointer, "dir");
				await rename(temporaryPointer, pointer);
				publicationState = "promoted-unconfirmed";
				return pointer;
			} finally {
				await rm(temporaryPointer, { force: true });
			}
		};
		await activeLock.runExclusive(promote);
		publicationState = "promoted-confirmed";
		return { pointer, publicationState };
	} catch (error) {
		throw new PackagePublicationError(error, publicationState, pointer);
	}
}

export async function resolveCurrentPackageImage(outputDir) {
	const outputRoot = await realpath(outputDir);
	const currentPath = join(outputRoot, "current");
	const currentStats = await lstat(currentPath);
	if (!currentStats.isSymbolicLink()) throw new Error("Current BYZ package pointer must be a symbolic link.");
	const imageDir = await realpath(currentPath);
	if (isOutside(outputRoot, imageDir)) throw new Error("Current BYZ package image escaped output root.");
	const generationsPath = join(outputRoot, "generations");
	const generationsStats = await lstat(generationsPath);
	if (generationsStats.isSymbolicLink() || !generationsStats.isDirectory()) {
		throw new Error("Current BYZ generations root must be a real directory.");
	}
	const generationsRoot = await realpath(generationsPath);
	if (isOutside(outputRoot, generationsRoot)) throw new Error("Current BYZ generations root escaped output root.");
	const relation = relative(generationsRoot, imageDir);
	const segments = relation.split(sep);
	if (isOutside(generationsRoot, imageDir) || segments.length !== 2 || !segments[0] || segments[1] !== "package") {
		throw new Error("Current BYZ package pointer does not reference a valid generation package.");
	}
	const imageStats = await lstat(imageDir);
	if (imageStats.isSymbolicLink() || !imageStats.isDirectory()) {
		throw new Error("Current BYZ package image must be a real directory.");
	}
	return imageDir;
}
