import { randomBytes } from "node:crypto";
import {
	chmodSync,
	closeSync,
	constants,
	fchmodSync,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readSync,
	writeFileSync,
} from "node:fs";
import { link, lstat, open, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const SCHEMA_VERSION = 1;
const MAX_PREFERENCES_BYTES = 16 * 1024;
const LANGUAGES = new Set(["auto", "zh", "en"]);
const DETAIL_MODES = new Set(["compact", "details"]);
const DEFAULT_PREFERENCES = Object.freeze({ detailMode: "compact", language: "auto", revision: 0 });
const CELL_DEFINITIONS = Object.freeze({
	detailMode: Object.freeze({ file: "detail-mode.json", values: DETAIL_MODES }),
	language: Object.freeze({ file: "language.json", values: LANGUAGES }),
});

class InvalidPreferencesError extends Error {}
class UnsafePreferencesError extends Error {}

function clonePreferences(value) {
	return Object.freeze({ detailMode: value.detailMode, language: value.language, revision: value.revision });
}

function sameIdentity(left, right) {
	return left.dev === right.dev && left.ino === right.ino && left.isFile() && right.isFile();
}

function sameDirectoryIdentity(left, right) {
	return left.dev === right.dev && left.ino === right.ino && left.isDirectory() && right.isDirectory();
}

function directoryAnchor(path, descriptor, platform = process.platform) {
	if (platform === "linux") return `/proc/self/fd/${descriptor}`;
	return path;
}

function openDirectoryBoundarySync(path, platform) {
	const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const opened = fstatSync(descriptor);
		const current = lstatSync(path);
		if (!sameDirectoryIdentity(opened, current)) throw new UnsafePreferencesError();
		return { anchor: directoryAnchor(path, descriptor, platform), descriptor, path, stats: opened };
	} catch (error) {
		closeSync(descriptor);
		throw error;
	}
}

async function openDirectoryBoundary(path, platform) {
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const opened = await handle.stat();
		const current = await lstat(path);
		if (!sameDirectoryIdentity(opened, current)) throw new UnsafePreferencesError();
		return { anchor: directoryAnchor(path, handle.fd, platform), handle, path, stats: opened };
	} catch (error) {
		await handle.close();
		throw error;
	}
}

async function assertDirectoryBoundaryCurrent(boundary) {
	const current = await lstat(boundary.path);
	if (!sameDirectoryIdentity(boundary.stats, current)) throw new UnsafePreferencesError();
}

function readDescriptorSync(path) {
	const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
	let descriptor;
	try {
		descriptor = openSync(path, flags);
		const opened = fstatSync(descriptor);
		const before = lstatSync(path);
		if (!sameIdentity(opened, before)) throw new UnsafePreferencesError();
		const buffer = Buffer.alloc(MAX_PREFERENCES_BYTES + 1);
		const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
		const after = lstatSync(path);
		if (!sameIdentity(opened, after)) throw new UnsafePreferencesError();
		if (bytesRead > MAX_PREFERENCES_BYTES) throw new InvalidPreferencesError();
		return { bytes: buffer.subarray(0, bytesRead), descriptor };
	} catch (error) {
		if (descriptor !== undefined) closeSync(descriptor);
		throw error;
	}
}

async function readDescriptor(path) {
	const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
	const handle = await open(path, flags);
	try {
		const opened = await handle.stat();
		const before = await lstat(path);
		if (!sameIdentity(opened, before)) throw new UnsafePreferencesError();
		const buffer = Buffer.alloc(MAX_PREFERENCES_BYTES + 1);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const after = await lstat(path);
		if (!sameIdentity(opened, after)) throw new UnsafePreferencesError();
		if (bytesRead > MAX_PREFERENCES_BYTES) throw new InvalidPreferencesError();
		return { bytes: buffer.subarray(0, bytesRead), handle };
	} catch (error) {
		await handle.close();
		throw error;
	}
}

function isolateCorruptBytes(path, bytes) {
	const quarantinePath = `${path}.corrupt`;
	try {
		writeFileSync(quarantinePath, bytes, { flag: "wx", mode: 0o600 });
		return basename(quarantinePath);
	} catch (error) {
		if (error?.code !== "EEXIST") return undefined;
		try {
			const info = lstatSync(quarantinePath);
			if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_PREFERENCES_BYTES) return undefined;
			chmodSync(quarantinePath, 0o600);
			return basename(quarantinePath);
		} catch {
			return undefined;
		}
	}
}

function parseLegacy(bytes) {
	const value = JSON.parse(bytes.toString("utf8"));
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidPreferencesError();
	const keys = Object.keys(value);
	if (keys.some((key) => key !== "language" && key !== "detailMode")) throw new InvalidPreferencesError();
	const languageValid = value.language === undefined || LANGUAGES.has(value.language);
	const detailModeValid = value.detailMode === undefined || DETAIL_MODES.has(value.detailMode);
	return {
		detailMode: detailModeValid
			? (value.detailMode ?? DEFAULT_PREFERENCES.detailMode)
			: DEFAULT_PREFERENCES.detailMode,
		invalid: !languageValid || !detailModeValid,
		language: languageValid ? (value.language ?? DEFAULT_PREFERENCES.language) : DEFAULT_PREFERENCES.language,
	};
}

function parseCell(bytes, field) {
	const value = JSON.parse(bytes.toString("utf8"));
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		!["field|ownerPid|revision|schemaVersion|value", "field|revision|schemaVersion|value"].includes(
			Object.keys(value).sort().join("|"),
		) ||
		value.schemaVersion !== SCHEMA_VERSION ||
		value.field !== field ||
		!Number.isSafeInteger(value.revision) ||
		value.revision < 1 ||
		!CELL_DEFINITIONS[field].values.has(value.value) ||
		(value.ownerPid !== undefined && (!Number.isSafeInteger(value.ownerPid) || value.ownerPid <= 0))
	) {
		throw new InvalidPreferencesError();
	}
	return { ownerPid: value.ownerPid, revision: value.revision, value: value.value };
}

function diagnosticFor(error, path, opened) {
	if (error?.code === "ENOENT") return Object.freeze({ state: "missing" });
	if (error instanceof InvalidPreferencesError || error instanceof SyntaxError) {
		return Object.freeze({
			state: "corrupt",
			quarantined: opened?.bytes ? isolateCorruptBytes(path, opened.bytes) : undefined,
		});
	}
	return Object.freeze({ state: "unavailable" });
}

function readOneSync(path, parse) {
	let opened;
	try {
		opened = readDescriptorSync(path);
		fchmodSync(opened.descriptor, 0o600);
		return { diagnostic: Object.freeze({ state: "ok" }), value: parse(opened.bytes) };
	} catch (error) {
		return { diagnostic: diagnosticFor(error, path, opened) };
	} finally {
		if (opened?.descriptor !== undefined) closeSync(opened.descriptor);
	}
}

async function readOne(path, parse) {
	let opened;
	try {
		opened = await readDescriptor(path);
		await opened.handle.chmod(0o600);
		return { diagnostic: Object.freeze({ state: "ok" }), value: parse(opened.bytes) };
	} catch (error) {
		return { diagnostic: diagnosticFor(error, path, opened) };
	} finally {
		await opened?.handle.close();
	}
}

function aggregateDiagnostic(legacy, cells) {
	const legacyDiagnostic = legacy.value?.invalid ? Object.freeze({ state: "corrupt" }) : legacy.diagnostic;
	const diagnostics = [legacyDiagnostic, ...Object.values(cells).map((entry) => entry.diagnostic)];
	const states = diagnostics.map((entry) => entry.state);
	const state = states.includes("unavailable")
		? "unavailable"
		: states.includes("corrupt")
			? "corrupt"
			: states.every((value) => value === "missing")
				? "missing"
				: "ok";
	const quarantined = diagnostics.find((entry) => entry.quarantined)?.quarantined;
	return Object.freeze(quarantined ? { quarantined, state } : { state });
}

function projectPreferences(legacy, cells) {
	const language = cells.language.value?.value ?? legacy.value?.language ?? DEFAULT_PREFERENCES.language;
	const detailMode = cells.detailMode.value?.value ?? legacy.value?.detailMode ?? DEFAULT_PREFERENCES.detailMode;
	const revision = (cells.language.value?.revision ?? 0) + (cells.detailMode.value?.revision ?? 0);
	if (!Number.isSafeInteger(revision)) throw new InvalidPreferencesError();
	return clonePreferences({ detailMode, language, revision });
}

function assertStorageDirectory(path, create = false) {
	if (create) mkdirSync(path, { mode: 0o700, recursive: true });
	const info = lstatSync(path);
	if (info.isSymbolicLink() || !info.isDirectory()) throw new UnsafePreferencesError();
	chmodSync(path, 0o700);
}

function readStateSync(configPath, cellDirectory, platform) {
	let parentBoundary;
	let cellBoundary;
	try {
		assertStorageDirectory(dirname(configPath));
		parentBoundary = openDirectoryBoundarySync(dirname(configPath), platform);
		try {
			assertStorageDirectory(cellDirectory);
			cellBoundary = openDirectoryBoundarySync(cellDirectory, platform);
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}
		const legacy = readOneSync(join(parentBoundary.anchor, basename(configPath)), parseLegacy);
		const cellRoot = cellBoundary?.anchor ?? join(parentBoundary.anchor, basename(cellDirectory));
		const cells = Object.fromEntries(
			Object.entries(CELL_DEFINITIONS).map(([field, definition]) => [
				field,
				readOneSync(join(cellRoot, definition.file), (bytes) => parseCell(bytes, field)),
			]),
		);
		return {
			diagnostic: aggregateDiagnostic(legacy, cells),
			preferences: projectPreferences(legacy, cells),
		};
	} catch (error) {
		return {
			diagnostic: Object.freeze({ state: error?.code === "ENOENT" ? "missing" : "unavailable" }),
			preferences: DEFAULT_PREFERENCES,
		};
	} finally {
		if (cellBoundary) closeSync(cellBoundary.descriptor);
		if (parentBoundary) closeSync(parentBoundary.descriptor);
	}
}

async function readState(configPath, cellDirectory) {
	const legacy = await readOne(configPath, parseLegacy);
	const cells = Object.fromEntries(
		await Promise.all(
			Object.entries(CELL_DEFINITIONS).map(async ([field, definition]) => [
				field,
				await readOne(join(cellDirectory, definition.file), (bytes) => parseCell(bytes, field)),
			]),
		),
	);
	return {
		diagnostic: aggregateDiagnostic(legacy, cells),
		preferences: projectPreferences(legacy, cells),
		cells,
	};
}

function inspectProcess(pid) {
	try {
		process.kill(pid, 0);
		return "live";
	} catch (error) {
		if (error?.code === "ESRCH") return "absent";
		return "unknown";
	}
}

function assertChanges(changes) {
	if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new Error("Invalid preference update.");
	const keys = Object.keys(changes);
	if (keys.length !== 1 || !CELL_DEFINITIONS[keys[0]]?.values.has(changes[keys[0]])) {
		throw new Error("Preference updates must contain one valid field.");
	}
	return keys[0];
}

async function ensureStorageDirectory(path, platform, manageExisting = true) {
	try {
		const info = lstatSync(path);
		if (info.isSymbolicLink() || !info.isDirectory()) throw new UnsafePreferencesError();
		if (manageExisting) chmodSync(path, 0o700);
		return false;
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}
	const parent = dirname(path);
	if (parent === path) throw new UnsafePreferencesError();
	await ensureStorageDirectory(parent, platform, false);
	const parentBoundary = await openDirectoryBoundary(parent, platform);
	try {
		await assertDirectoryBoundaryCurrent(parentBoundary);
		try {
			mkdirSync(path, { mode: 0o700 });
		} catch (error) {
			if (error?.code !== "EEXIST") throw error;
		}
		await assertDirectoryBoundaryCurrent(parentBoundary);
		if (platform !== "win32") await parentBoundary.handle.sync();
	} finally {
		await parentBoundary.handle.close();
	}
	assertStorageDirectory(path);
	return true;
}

export function getConversationConfigPath(env = process.env) {
	return join(env.BYZ_CODING_AGENT_DIR || join(homedir(), ".byz", "agent"), "conversation.json");
}

export function createConversationPreferencesRepository(options = {}) {
	const configPath = options.configPath ?? getConversationConfigPath(options.env);
	const cellDirectory = `${configPath}.d`;
	const platform = options.platform ?? process.platform;
	return Object.freeze({
		read() {
			return readStateSync(configPath, cellDirectory, platform);
		},
		async update(changes) {
			const field = assertChanges(changes);
			await ensureStorageDirectory(dirname(configPath), platform);
			await ensureStorageDirectory(cellDirectory, platform);
			const parentBoundary = await openDirectoryBoundary(dirname(configPath), platform);
			const cellBoundary = await openDirectoryBoundary(cellDirectory, platform);
			let ownedClaimPath;
			try {
				const anchoredConfig = join(parentBoundary.anchor, basename(configPath));
				const definition = CELL_DEFINITIONS[field];
				const destination = join(cellBoundary.anchor, definition.file);
				const successResult = (state) => ({
					diagnostic: Object.freeze({ state: "ok" }),
					preferences: clonePreferences({
						...state.preferences,
						[field]: changes[field],
						revision: state.preferences.revision + 1,
					}),
				});
				for (let attempt = 0; attempt < 16; attempt += 1) {
					await assertDirectoryBoundaryCurrent(parentBoundary);
					await assertDirectoryBoundaryCurrent(cellBoundary);
					const state = await readState(anchoredConfig, cellBoundary.anchor);
					if (state.diagnostic.state === "unavailable") {
						throw new Error("Conversation preferences are unavailable.");
					}
					const revision = state.cells[field].value?.revision ?? 0;
					if (revision === Number.MAX_SAFE_INTEGER) {
						throw new Error("Conversation preference revision is exhausted.");
					}
					const nextRevision = revision + 1;
					const claim = join(cellBoundary.anchor, `.${definition.file}.next-${nextRevision}`);
					const temporaryPath = join(
						cellBoundary.anchor,
						`.${definition.file}.${randomBytes(16).toString("hex")}.tmp`,
					);
					let ownsClaim = false;
					try {
						const handle = await open(temporaryPath, "wx", 0o600);
						try {
							await handle.writeFile(
								`${JSON.stringify({ field, ownerPid: process.pid, revision: nextRevision, schemaVersion: SCHEMA_VERSION, value: changes[field] })}\n`,
							);
							await handle.sync();
						} finally {
							await handle.close();
						}
						try {
							await link(temporaryPath, claim);
							ownsClaim = true;
							ownedClaimPath = claim;
						} catch (error) {
							if (error?.code !== "EEXIST") throw error;
						}
					} finally {
						await rm(temporaryPath, { force: true }).catch(() => {});
					}

					if (!ownsClaim) {
						const existingClaim = await readOne(claim, (bytes) => parseCell(bytes, field));
						if (
							existingClaim.diagnostic.state !== "ok" ||
							existingClaim.value.revision !== nextRevision ||
							existingClaim.value.ownerPid === undefined ||
							inspectProcess(existingClaim.value.ownerPid) !== "absent"
						) {
							throw new Error("Conversation preference field is busy.");
						}
						const current = await readOne(destination, (bytes) => parseCell(bytes, field));
						const currentRevision = current.diagnostic.state === "ok" ? current.value.revision : 0;
						if (currentRevision === revision) {
							await rename(claim, destination);
							await cellBoundary.handle.sync();
						} else if (currentRevision >= nextRevision) {
							await rm(claim, { force: true });
						}
						continue;
					}
					await cellBoundary.handle.sync();
					await options.beforePublish?.({ field, revision: nextRevision });
					await assertDirectoryBoundaryCurrent(parentBoundary);
					await assertDirectoryBoundaryCurrent(cellBoundary);
					const claimed = await readOne(claim, (bytes) => parseCell(bytes, field));
					const current = await readOne(destination, (bytes) => parseCell(bytes, field));
					if (current.diagnostic.state === "unavailable") {
						throw new Error("Conversation preference destination is unsafe.");
					}
					if (claimed.diagnostic.state === "missing") {
						throw new Error("Conversation preference claim disappeared before publication.");
					}
					if (claimed.diagnostic.state !== "ok" || claimed.value.revision !== nextRevision) {
						throw new Error("Conversation preference claim is invalid.");
					}
					const currentRevision = current.diagnostic.state === "ok" ? current.value.revision : 0;
					if (currentRevision !== revision) {
						throw new Error("Conversation preference revision changed before publication.");
					}
					await rename(claim, destination);
					ownedClaimPath = undefined;
					await cellBoundary.handle.sync();
					await assertDirectoryBoundaryCurrent(cellBoundary);
					const published = await readOne(destination, (bytes) => parseCell(bytes, field));
					if (
						published.diagnostic.state === "ok" &&
						published.value.revision === nextRevision &&
						published.value.value === changes[field]
					) {
						return successResult(state);
					}
				}
				throw new Error("Conversation preference update contention exceeded the retry limit.");
			} finally {
				if (ownedClaimPath) await rm(ownedClaimPath, { force: true }).catch(() => {});
				await cellBoundary.handle.close();
				await parentBoundary.handle.close();
			}
		},
	});
}
