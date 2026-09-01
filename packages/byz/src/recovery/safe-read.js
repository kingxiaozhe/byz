import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";

function errorCode(error) {
	return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function identity(stats) {
	return `${stats.dev}:${stats.ino}`;
}

function sameFile(left, right) {
	return (
		left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeNs === right.mtimeNs
	);
}

export function isContainedPath(root, candidate) {
	const relation = relative(root, candidate);
	return relation === "" || (relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}

export async function inspectDirectoryBoundary(fs, path, allowedRoot) {
	try {
		const stats = await fs.lstat(path, { bigint: true });
		if (stats.isSymbolicLink() || !stats.isDirectory()) return { state: "rejected", reasonCode: "unsafe_path" };
		const realPath = await fs.realpath(path);
		if (allowedRoot !== undefined && !isContainedPath(allowedRoot, realPath)) {
			return { state: "rejected", reasonCode: "unsafe_path" };
		}
		return Object.freeze({ state: "found", path: realPath, identity: identity(stats) });
	} catch (error) {
		if (errorCode(error) === "ENOENT") return { state: "absent" };
		return { state: "unavailable", reasonCode: "io_error" };
	}
}

export async function revalidateDirectoryBoundary(fs, boundary) {
	try {
		const stats = await fs.lstat(boundary.path, { bigint: true });
		return !stats.isSymbolicLink() && stats.isDirectory() && identity(stats) === boundary.identity;
	} catch {
		return false;
	}
}

export async function readBoundedRegularFile({
	fs,
	path,
	allowedRoot,
	relativePath,
	maxBytes,
	budget,
	readLimit,
	projectBytes,
}) {
	let handle;
	try {
		const before = await fs.lstat(path, { bigint: true });
		if (before.isSymbolicLink() || !before.isFile()) return { state: "rejected", reasonCode: "unsafe_path" };
		const realPath = await fs.realpath(path);
		if (!isContainedPath(allowedRoot, realPath)) return { state: "rejected", reasonCode: "unsafe_path" };
		if (typeof constants.O_NOFOLLOW !== "number") return { state: "unavailable", reasonCode: "no_nofollow" };
		handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		const opened = await handle.stat({ bigint: true });
		if (!opened.isFile() || !sameFile(before, opened)) return { state: "rejected", reasonCode: "source_changed" };
		if (opened.size > BigInt(maxBytes)) return { state: "rejected", reasonCode: "size_limit" };
		const fileSize = Number(opened.size);
		const expectedReadSize = readLimit === undefined ? fileSize : Math.min(fileSize, readLimit);
		if (!Number.isSafeInteger(expectedReadSize) || expectedReadSize < 0 || expectedReadSize > budget.remaining) {
			return { state: "rejected", reasonCode: "size_limit" };
		}
		const bytes = Buffer.alloc(expectedReadSize);
		let offset = 0;
		while (offset < expectedReadSize) {
			const result = await handle.read(bytes, offset, expectedReadSize - offset, offset);
			if (result.bytesRead === 0) break;
			offset += result.bytesRead;
		}
		const after = await handle.stat({ bigint: true });
		if (offset !== expectedReadSize || !sameFile(opened, after)) {
			return { state: "rejected", reasonCode: "source_changed" };
		}
		const projectedBytes = projectBytes === undefined ? bytes : projectBytes(bytes);
		if (!Buffer.isBuffer(projectedBytes)) return { state: "rejected", reasonCode: "content_limit" };
		budget.remaining -= expectedReadSize;
		return Object.freeze({
			state: "found",
			bytes: projectedBytes,
			receipt: Object.freeze({
				relativePath,
				sha256: createHash("sha256").update(projectedBytes).digest("hex"),
				size: projectedBytes.length,
				identity: identity(opened),
			}),
		});
	} catch (error) {
		if (errorCode(error) === "ENOENT") return { state: "absent" };
		if (["ELOOP", "EMLINK"].includes(errorCode(error))) return { state: "rejected", reasonCode: "unsafe_path" };
		return { state: "unavailable", reasonCode: "io_error" };
	} finally {
		await handle?.close().catch(() => undefined);
	}
}
