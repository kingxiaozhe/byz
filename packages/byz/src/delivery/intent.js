import { randomBytes } from "node:crypto";

const ACTIONS = new Set(["commit", "push", "pr", "merge"]);

export function createDeliveryIntentStore(options = {}) {
	const now = options.now ?? Date.now;
	const ttlMs = options.ttlMs ?? 5 * 60_000;
	let active;
	return Object.freeze({
		create(action, snapshot, target) {
			if (!ACTIONS.has(action) || typeof snapshot?.fingerprint !== "string")
				throw new Error("Invalid delivery intent.");
			const frozenTarget = Object.freeze(
				Object.fromEntries(
					Object.entries(target ?? {}).map(([key, value]) => [
						key,
						Array.isArray(value) ? Object.freeze([...value]) : value,
					]),
				),
			);
			active = Object.freeze({
				action,
				consumed: false,
				expiresAt: now() + ttlMs,
				fingerprint: snapshot.fingerprint,
				intentId: randomBytes(16).toString("hex"),
				target: frozenTarget,
			});
			return active;
		},
		consume(intentId, action, snapshot) {
			if (
				!active ||
				active.consumed ||
				active.intentId !== intentId ||
				active.action !== action ||
				now() > active.expiresAt ||
				active.fingerprint !== snapshot?.fingerprint
			) {
				active = undefined;
				return undefined;
			}
			const consumed = Object.freeze({ ...active, consumed: true });
			active = undefined;
			return consumed;
		},
		cancel() {
			active = undefined;
		},
		snapshot() {
			return active;
		},
	});
}
