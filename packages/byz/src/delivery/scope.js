import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_SCOPE_RECEIPTS = 128;
const SAFE_PATH = /^[^\u0000-\u001f\u007f]+$/;

function inside(root, path) {
	const value = relative(root, path);
	return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

async function digestRegularFile(path) {
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const stats = await handle.stat();
		if (!stats.isFile() || stats.size > MAX_FILE_BYTES)
			throw new Error("Delivery candidate is not a bounded regular file.");
		const hash = createHash("sha256");
		const buffer = Buffer.alloc(64 * 1024);
		let position = 0;
		while (position < stats.size) {
			const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, stats.size - position), position);
			if (bytesRead === 0) throw new Error("Delivery candidate changed while reading.");
			hash.update(buffer.subarray(0, bytesRead));
			position += bytesRead;
		}
		const after = await handle.stat();
		if (
			after.dev !== stats.dev ||
			after.ino !== stats.ino ||
			after.size !== stats.size ||
			after.mtimeMs !== stats.mtimeMs
		) {
			throw new Error("Delivery candidate changed while reading.");
		}
		return hash.digest("hex");
	} finally {
		await handle.close();
	}
}

export function createDeliveryScopeTracker(options) {
	const root = resolve(options.cwd);
	const entries = new Map();
	let sequence = 0;

	async function normalizePath(input) {
		if (typeof input !== "string" || input.length === 0 || input.length > 512 || !SAFE_PATH.test(input)) {
			throw new Error("Invalid delivery path.");
		}
		const absolute = resolve(root, input);
		if (!inside(root, absolute)) throw new Error("Delivery path is outside the workspace.");
		const [realRoot, realPath] = await Promise.all([realpath(root), realpath(absolute)]);
		if (!inside(realRoot, realPath)) throw new Error("Delivery path escapes the workspace.");
		return { absolute: realPath, relativePath: relative(realRoot, realPath).split(sep).join("/") };
	}

	return Object.freeze({
		async observe(input) {
			if (
				sequence >= MAX_SCOPE_RECEIPTS ||
				input?.outcome !== "success" ||
				!["edit", "write"].includes(input.toolName) ||
				typeof input.toolCallId !== "string" ||
				input.toolCallId.length === 0 ||
				input.toolCallId.length > 128
			) {
				return false;
			}
			const plan = input.registrySnapshot?.availability === "available" ? input.registrySnapshot.plan : undefined;
			if (!plan || !["sealed", "terminal"].includes(plan.state) || typeof plan.id !== "string") return false;
			const target = await normalizePath(input.path);
			const digest = await digestRegularFile(target.absolute);
			const receipt = Object.freeze({
				schemaVersion: 1,
				digest,
				generation: input.registrySnapshot.generation,
				path: target.relativePath,
				planId: plan.id,
				sequence: sequence + 1,
				taskId: plan.active?.id,
			});
			await options.appendReceipt(receipt);
			sequence += 1;
			entries.set(target.relativePath, receipt);
			return true;
		},
		async candidates() {
			const result = [];
			const currentRegistry = options.readRegistrySnapshot?.();
			const currentPlan = currentRegistry?.availability === "available" ? currentRegistry.plan : undefined;
			for (const receipt of entries.values()) {
				if (
					receipt.generation !== currentRegistry?.generation ||
					receipt.planId !== currentPlan?.id ||
					options.hasTask?.(receipt.planId, receipt.taskId, receipt.generation) !== true
				) {
					result.push(Object.freeze({ ...receipt, current: false }));
					continue;
				}
				try {
					const target = await normalizePath(receipt.path);
					const digest = await digestRegularFile(target.absolute);
					result.push(Object.freeze({ ...receipt, current: digest === receipt.digest }));
				} catch {
					result.push(Object.freeze({ ...receipt, current: false }));
				}
			}
			return Object.freeze(result);
		},
		replay(receipts) {
			entries.clear();
			sequence = 0;
			const currentRegistry = options.readRegistrySnapshot?.();
			const currentPlan = currentRegistry?.availability === "available" ? currentRegistry.plan : undefined;
			if (!Array.isArray(receipts) || receipts.length > MAX_SCOPE_RECEIPTS) return false;
			for (const receipt of receipts) {
				if (receipt?.generation !== currentRegistry?.generation || receipt?.planId !== currentPlan?.id) continue;
				if (
					receipt?.schemaVersion !== 1 ||
					!Number.isSafeInteger(receipt.sequence) ||
					receipt.sequence !== sequence + 1 ||
					typeof receipt.path !== "string" ||
					typeof receipt.taskId !== "string" ||
					options.hasTask?.(receipt.planId, receipt.taskId, receipt.generation) !== true ||
					!/^[0-9a-f]{64}$/.test(receipt.digest ?? "")
				) {
					entries.clear();
					sequence = 0;
					return false;
				}
				sequence = receipt.sequence;
				entries.set(receipt.path, Object.freeze({ ...receipt }));
			}
			return true;
		},
	});
}
