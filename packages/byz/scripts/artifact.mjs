import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { lstat, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, posix } from "node:path";
import { createGunzip } from "node:zlib";

export const ARTIFACT_LIMITS = Object.freeze({
	maxCompressedBytes: 512 * 1024 * 1024,
	maxEntries: 10_000,
	maxMetadataBytes: 1024 * 1024,
	maxReceiptBytes: 16 * 1024 * 1024,
	maxTotalMetadataBytes: 16 * 1024 * 1024,
	maxSingleFileBytes: 128 * 1024 * 1024,
	maxTotalBytes: 512 * 1024 * 1024,
});

function parseTarString(buffer) {
	const end = buffer.indexOf(0);
	return buffer.subarray(0, end === -1 ? buffer.length : end).toString("utf8");
}

function parseTarNumber(buffer, label) {
	if ((buffer[0] & 0x80) !== 0) throw new Error(`BYZ tar ${label} uses unsupported base-256 encoding.`);
	const value = buffer.toString("ascii").replaceAll("\0", "").trim();
	if (!value) return 0;
	if (!/^[0-7]+$/.test(value)) throw new Error(`BYZ tar ${label} is not valid octal.`);
	const parsed = Number.parseInt(value, 8);
	if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`BYZ tar ${label} is out of range.`);
	return parsed;
}

function verifyTarChecksum(header) {
	const expected = parseTarNumber(header.subarray(148, 156), "checksum");
	let actual = 0;
	for (let index = 0; index < header.length; index++) {
		actual += index >= 148 && index < 156 ? 0x20 : header[index];
	}
	if (actual !== expected) throw new Error("BYZ tar header checksum mismatch.");
}

function validateArtifactPath(path) {
	if (
		!path ||
		isAbsolute(path) ||
		path.includes("\\") ||
		/[\0-\x1f\x7f]/.test(path) ||
		/^[A-Za-z]:/.test(path) ||
		path !== posix.normalize(path) ||
		path.startsWith("./") ||
		path.endsWith("/") ||
		path.split("/").some((segment) => segment === "." || segment === "..")
	) {
		throw new Error(`BYZ tar contains an unsafe path: ${String(path)}`);
	}
	return path;
}

function parsePax(payload) {
	const values = {};
	let offset = 0;
	while (offset < payload.length) {
		const space = payload.indexOf(0x20, offset);
		if (space === -1) throw new Error("BYZ tar contains malformed PAX metadata.");
		const lengthText = payload.subarray(offset, space).toString("ascii");
		if (!/^[1-9]\d*$/.test(lengthText)) throw new Error("BYZ tar contains malformed PAX length.");
		const length = Number.parseInt(lengthText, 10);
		const end = offset + length;
		if (!Number.isSafeInteger(length) || end > payload.length || payload[end - 1] !== 0x0a) {
			throw new Error("BYZ tar contains truncated PAX metadata.");
		}
		const record = payload.subarray(space + 1, end - 1).toString("utf8");
		const equals = record.indexOf("=");
		if (equals <= 0) throw new Error("BYZ tar contains malformed PAX record.");
		values[record.slice(0, equals)] = record.slice(equals + 1);
		offset = end;
	}
	return values;
}

export async function inspectTarHeaders(tarballPath, limits = ARTIFACT_LIMITS) {
	const entries = [];
	const seen = new Set();
	let totalBytes = 0;
	let totalMetadataBytes = 0;
	let expandedBytes = 0;
	let headerBuffer = Buffer.alloc(0);
	let dataRemaining = 0;
	let paddingRemaining = 0;
	let capture = [];
	let captureLength = 0;
	let currentFileEntry;
	let currentFileHash;
	let expectsEntryAfterMetadata = false;
	let metadataType;
	let pendingPath;
	let pendingSize;
	let zeroBlocks = 0;
	let complete = false;

	const finishData = () => {
		if (metadataType) {
			const payload = Buffer.concat(capture, captureLength);
			if (metadataType === "x") {
				const pax = parsePax(payload);
				if (pax.path !== undefined) pendingPath = pax.path;
				if (pax.size !== undefined) {
					if (!/^\d+$/.test(pax.size)) throw new Error("BYZ tar PAX size is invalid.");
					pendingSize = Number.parseInt(pax.size, 10);
					if (!Number.isSafeInteger(pendingSize)) throw new Error("BYZ tar PAX size is out of range.");
				}
			} else if (metadataType === "L") {
				pendingPath = parseTarString(payload).replace(/\n$/, "");
			} else {
				throw new Error(`BYZ tar contains unsupported metadata type: ${metadataType}`);
			}
			metadataType = undefined;
			expectsEntryAfterMetadata = true;
			capture = [];
			captureLength = 0;
		}
		if (currentFileHash && currentFileEntry) {
			currentFileEntry.sha256 = currentFileHash.digest("hex");
			currentFileHash = undefined;
			currentFileEntry = undefined;
		}
	};

	const stream = createReadStream(tarballPath).pipe(createGunzip());
	for await (const chunk of stream) {
		expandedBytes += chunk.length;
		if (expandedBytes > limits.maxTotalBytes + limits.maxTotalMetadataBytes + limits.maxEntries * 1024) {
			throw new Error("BYZ tar exceeds its bounded stream expansion limit.");
		}
		let offset = 0;
		while (offset < chunk.length) {
			if (complete) {
				for (let index = offset; index < chunk.length; index++) {
					if (chunk[index] !== 0) throw new Error("BYZ tar contains data after its end marker.");
				}
				break;
			}
			if (dataRemaining > 0) {
				const length = Math.min(dataRemaining, chunk.length - offset);
				if (metadataType) {
					capture.push(chunk.subarray(offset, offset + length));
					captureLength += length;
				}
				if (currentFileHash) currentFileHash.update(chunk.subarray(offset, offset + length));
				offset += length;
				dataRemaining -= length;
				if (dataRemaining === 0) finishData();
				continue;
			}
			if (paddingRemaining > 0) {
				const length = Math.min(paddingRemaining, chunk.length - offset);
				for (let index = offset; index < offset + length; index++) {
					if (chunk[index] !== 0) throw new Error("BYZ tar contains non-zero entry padding.");
				}
				offset += length;
				paddingRemaining -= length;
				continue;
			}
			const needed = 512 - headerBuffer.length;
			const length = Math.min(needed, chunk.length - offset);
			headerBuffer = Buffer.concat([headerBuffer, chunk.subarray(offset, offset + length)]);
			offset += length;
			if (headerBuffer.length < 512) continue;
			const header = headerBuffer;
			headerBuffer = Buffer.alloc(0);
			if (header.every((byte) => byte === 0)) {
				zeroBlocks += 1;
				if (zeroBlocks === 2) complete = true;
				continue;
			}
			zeroBlocks = 0;
			verifyTarChecksum(header);
			const headerName = parseTarString(header.subarray(0, 100));
			const prefix = parseTarString(header.subarray(345, 500));
			const rawPath = pendingPath ?? (prefix ? `${prefix}/${headerName}` : headerName);
			const size = parseTarNumber(header.subarray(124, 136), "entry size");
			const mode = parseTarNumber(header.subarray(100, 108), "entry mode");
			const type = String.fromCharCode(header[156] || 0x30);
			if (type === "x" || type === "L") {
				if (expectsEntryAfterMetadata) throw new Error("BYZ tar metadata is not followed by a filesystem entry.");
				if (size > limits.maxMetadataBytes) throw new Error("BYZ tar metadata exceeds its size limit.");
				totalMetadataBytes += size;
				if (totalMetadataBytes > limits.maxTotalMetadataBytes) {
					throw new Error("BYZ tar metadata exceeds its total size limit.");
				}
				metadataType = type;
				dataRemaining = size;
				paddingRemaining = (512 - (size % 512)) % 512;
				if (size === 0) finishData();
				continue;
			}
			if (type === "g" || type === "K") throw new Error(`BYZ tar contains unsupported metadata type: ${type}`);
			if (pendingSize !== undefined && pendingSize !== size)
				throw new Error("BYZ tar PAX size does not match its entry header.");
			expectsEntryAfterMetadata = false;
			pendingPath = undefined;
			pendingSize = undefined;
			if (!rawPath.startsWith("package/")) throw new Error(`BYZ tar contains an unexpected root path: ${rawPath}`);
			const relativePath = rawPath.slice("package/".length);
			const packagePath = validateArtifactPath(type === "5" ? relativePath.replace(/\/$/, "") : relativePath);
			if (seen.has(packagePath)) throw new Error(`BYZ tar contains a duplicate path: ${packagePath}`);
			seen.add(packagePath);
			if (entries.length >= limits.maxEntries) throw new Error("BYZ tar exceeds its entry-count limit.");
			if (type === "5") {
				if (size !== 0) throw new Error(`BYZ tar directory has data: ${packagePath}`);
				entries.push({ mode, path: packagePath, size: 0, type: "directory" });
			} else if (type === "0") {
				if (size > limits.maxSingleFileBytes)
					throw new Error(`BYZ tar file exceeds its size limit: ${packagePath}`);
				totalBytes += size;
				if (totalBytes > limits.maxTotalBytes) throw new Error("BYZ tar exceeds its total expansion limit.");
				currentFileEntry = { mode, path: packagePath, size, type: "file" };
				currentFileHash = createHash("sha256");
				entries.push(currentFileEntry);
			} else {
				throw new Error(`BYZ tar contains a link or special entry: ${packagePath}`);
			}
			dataRemaining = size;
			paddingRemaining = (512 - (size % 512)) % 512;
			if (size === 0) finishData();
		}
	}
	if (
		!complete ||
		headerBuffer.length !== 0 ||
		dataRemaining !== 0 ||
		paddingRemaining !== 0 ||
		metadataType ||
		expectsEntryAfterMetadata ||
		pendingPath !== undefined ||
		pendingSize !== undefined
	) {
		throw new Error("BYZ tar ended before a complete end marker.");
	}
	entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
	const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
	for (const entry of entries) {
		const segments = entry.path.split("/");
		for (let index = 1; index < segments.length; index++) {
			const ancestor = entryByPath.get(segments.slice(0, index).join("/"));
			if (ancestor?.type === "file")
				throw new Error(`BYZ tar file is an ancestor of another entry: ${ancestor.path}`);
		}
	}
	return { entries, totalBytes };
}

export async function sha256File(path) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

async function readJsonNoFollow(path, label) {
	let handle;
	try {
		const pathStats = await lstat(path);
		if (pathStats.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link.`);
		handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const before = await handle.stat();
		if (!before.isFile() || before.size > ARTIFACT_LIMITS.maxReceiptBytes) {
			throw new Error(`${label} must be a bounded regular file.`);
		}
		const content = await handle.readFile("utf8");
		const after = await handle.stat();
		if (
			before.dev !== after.dev ||
			before.ino !== after.ino ||
			before.size !== after.size ||
			before.mtimeMs !== after.mtimeMs ||
			Buffer.byteLength(content) !== before.size
		) {
			throw new Error(`${label} changed while being read.`);
		}
		return JSON.parse(content);
	} finally {
		await handle?.close();
	}
}

function validateReceipt(receipt) {
	if (
		receipt?.schemaVersion !== 1 ||
		!/^generations\/[^/]+\/package$/.test(receipt.generationIdentity ?? "") ||
		[".", ".."].includes(receipt.generationIdentity?.split("/")[1]) ||
		!/^([0-9a-f]{64})$/.test(receipt.imageMetadataSha256 ?? "") ||
		!/^@aibyzero\/byz$/.test(receipt.package?.name ?? "") ||
		typeof receipt.package?.version !== "string" ||
		!/^\d+(?:\.\d+){2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(receipt.package.version) ||
		!/^([0-9a-f]{64})$/.test(receipt.tarball?.sha256 ?? "") ||
		!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(receipt.tarball?.integrity ?? "") ||
		!Number.isSafeInteger(receipt.tarball?.size) ||
		receipt.tarball.size < 0 ||
		receipt.tarball.size > ARTIFACT_LIMITS.maxCompressedBytes ||
		!Array.isArray(receipt.entries) ||
		receipt.entries.length > ARTIFACT_LIMITS.maxEntries ||
		!Number.isSafeInteger(receipt.totalBytes) ||
		receipt.totalBytes < 0 ||
		receipt.totalBytes > ARTIFACT_LIMITS.maxTotalBytes
	) {
		throw new Error("Invalid BYZ artifact receipt.");
	}
	let previousPath;
	let totalBytes = 0;
	for (const entry of receipt.entries) {
		if (
			!entry ||
			validateArtifactPath(entry.path) !== entry.path ||
			(entry.type !== "file" && entry.type !== "directory") ||
			!Number.isSafeInteger(entry.mode) ||
			entry.mode < 0 ||
			entry.mode > 0o7777 ||
			!Number.isSafeInteger(entry.size) ||
			entry.size < 0 ||
			(entry.type === "directory" && (entry.size !== 0 || entry.sha256 !== undefined)) ||
			(entry.type === "file" && !/^[0-9a-f]{64}$/.test(entry.sha256 ?? "")) ||
			entry.size > ARTIFACT_LIMITS.maxSingleFileBytes ||
			(previousPath !== undefined && previousPath >= entry.path)
		) {
			throw new Error("Invalid BYZ artifact receipt entry.");
		}
		if (entry.type === "file") totalBytes += entry.size;
		previousPath = entry.path;
	}
	if (totalBytes !== receipt.totalBytes) throw new Error("Invalid BYZ artifact receipt total size.");
	const entryByPath = new Map(receipt.entries.map((entry) => [entry.path, entry]));
	for (const entry of receipt.entries) {
		const segments = entry.path.split("/");
		for (let index = 1; index < segments.length; index++) {
			if (entryByPath.get(segments.slice(0, index).join("/"))?.type === "file") {
				throw new Error("Invalid BYZ artifact receipt file ancestry.");
			}
		}
	}
	return receipt;
}

export async function validateImageAgainstReceipt(imageDir, receipt) {
	validateReceipt(receipt);
	for (const entry of receipt.entries) {
		const target = join(imageDir, entry.path);
		const stats = await lstat(target);
		if (stats.isSymbolicLink() || (entry.type === "file" ? !stats.isFile() : !stats.isDirectory())) {
			throw new Error(`BYZ current image entry type does not match its receipt: ${entry.path}`);
		}
		if (
			entry.type === "file" &&
			(stats.size !== entry.size ||
				(stats.mode & 0o7777) !== entry.mode ||
				(await sha256File(target)) !== entry.sha256)
		) {
			throw new Error(`BYZ current image content does not match its receipt: ${entry.path}`);
		}
	}
}

export async function captureArtifact(tarballPath, { onChunk } = {}) {
	const captureDir = await mkdtemp(join(tmpdir(), "byz-artifact-snapshot-"));
	let source;
	let target;
	try {
		const pathStats = await lstat(tarballPath);
		if (pathStats.isSymbolicLink() || !pathStats.isFile())
			throw new Error("BYZ artifact must be a regular non-symlink file.");
		source = await open(tarballPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const before = await source.stat();
		if (!before.isFile() || before.size > ARTIFACT_LIMITS.maxCompressedBytes) {
			throw new Error("BYZ artifact exceeds its compressed-size limit.");
		}
		const snapshotPath = join(captureDir, "artifact.tgz");
		target = await open(snapshotPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
		const sha256 = createHash("sha256");
		const sha512 = createHash("sha512");
		let capturedBytes = 0;
		for await (const chunk of source.createReadStream({ autoClose: false })) {
			capturedBytes += chunk.length;
			await onChunk?.({ capturedBytes });
			if (capturedBytes > ARTIFACT_LIMITS.maxCompressedBytes || capturedBytes > before.size) {
				throw new Error("BYZ artifact grew beyond its capture limit.");
			}
			sha256.update(chunk);
			sha512.update(chunk);
			let offset = 0;
			while (offset < chunk.length) {
				const { bytesWritten } = await target.write(chunk, offset, chunk.length - offset);
				if (bytesWritten <= 0) throw new Error("Could not capture the BYZ artifact snapshot.");
				offset += bytesWritten;
			}
		}
		const after = await source.stat();
		const capturedStats = await target.stat();
		if (
			before.dev !== after.dev ||
			before.ino !== after.ino ||
			before.size !== after.size ||
			before.mtimeMs !== after.mtimeMs ||
			before.ctimeMs !== after.ctimeMs ||
			capturedStats.size !== before.size
		) {
			throw new Error("BYZ artifact changed while it was being captured.");
		}
		return {
			async release() {
				await rm(captureDir, { force: true, recursive: true });
			},
			integrity: `sha512-${sha512.digest("base64")}`,
			sha256: sha256.digest("hex"),
			size: capturedStats.size,
			snapshotPath,
		};
	} catch (error) {
		await rm(captureDir, { force: true, recursive: true });
		throw error;
	} finally {
		await Promise.all([source?.close(), target?.close()]);
	}
}

export async function verifyArtifact({ expectedGenerationIdentity, expectedSha256, receiptPath, tarballPath }) {
	const receipt = validateReceipt(await readJsonNoFollow(receiptPath, "BYZ artifact receipt"));
	const captured = await captureArtifact(tarballPath);
	try {
		const digest = captured.sha256;
		if (
			digest !== receipt.tarball.sha256 ||
			captured.integrity !== receipt.tarball.integrity ||
			captured.size !== receipt.tarball.size
		) {
			throw new Error("BYZ artifact bytes do not match its receipt.");
		}
		if (
			(expectedSha256 !== undefined && digest !== expectedSha256) ||
			(expectedGenerationIdentity !== undefined && receipt.generationIdentity !== expectedGenerationIdentity)
		) {
			throw new Error("BYZ artifact does not match the expected release dry-run identity.");
		}
		const inspected = await inspectTarHeaders(captured.snapshotPath);
		if (
			inspected.totalBytes !== receipt.totalBytes ||
			JSON.stringify(inspected.entries) !== JSON.stringify(receipt.entries)
		) {
			throw new Error("BYZ artifact headers do not match its receipt.");
		}
		return { captured, receipt, sha256: digest };
	} catch (error) {
		await captured.release();
		throw error;
	}
}
