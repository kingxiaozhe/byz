const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const TEST_CASE_PATTERN = /^TC-[A-Za-z0-9._-]{1,60}$/;

export const EXECUTION_LIMITS = Object.freeze({ tasks: 64, receipts: 128 });

export function isPlainObject(value) {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

export function hasExactKeys(value, keys) {
	return isPlainObject(value) && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

export function isBoundedId(value) {
	return typeof value === "string" && ID_PATTERN.test(value);
}

export function isTestCaseId(value) {
	return typeof value === "string" && TEST_CASE_PATTERN.test(value);
}

export function sanitizeLabel(value) {
	if (value === undefined) return undefined;
	if (typeof value !== "string") return null;
	const sanitized = value
		.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)?/g, "")
		.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return [...sanitized].length <= 120 ? sanitized : null;
}

export function normalizeTasks(value) {
	if (!Array.isArray(value) || value.length < 1 || value.length > EXECUTION_LIMITS.tasks) return undefined;
	const ids = new Set();
	const tasks = [];
	for (const candidate of value) {
		if (!hasExactKeys(candidate, candidate?.label === undefined ? ["id"] : ["id", "label"])) return undefined;
		if (!isBoundedId(candidate.id) || ids.has(candidate.id)) return undefined;
		const label = sanitizeLabel(candidate.label);
		if (label === null) return undefined;
		ids.add(candidate.id);
		tasks.push(label === undefined ? { id: candidate.id } : { id: candidate.id, label });
	}
	return tasks;
}

function canonicalPart(value, context, depth) {
	if (depth > 8 || context.nodes > 2048 || context.characters > 16_384) return undefined;
	context.nodes += 1;
	if (value === null || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") return Number.isSafeInteger(value) ? String(value) : undefined;
	if (typeof value === "string") {
		context.characters += value.length;
		return context.characters <= 16_384 ? JSON.stringify(value) : undefined;
	}
	if (typeof value !== "object" || context.seen.has(value)) return undefined;
	context.seen.add(value);
	if (Array.isArray(value)) {
		if (value.length > 128) return undefined;
		const parts = value.map((item) => canonicalPart(item, context, depth + 1));
		return parts.includes(undefined) ? undefined : `[${parts.join(",")}]`;
	}
	if (!isPlainObject(value)) return undefined;
	const keys = Object.keys(value).sort();
	if (keys.length > 16 || keys.some((key) => key.length > 64)) return undefined;
	const parts = keys.map((key) => {
		const item = canonicalPart(value[key], context, depth + 1);
		return item === undefined ? undefined : `${JSON.stringify(key)}:${item}`;
	});
	return parts.includes(undefined) ? undefined : `{${parts.join(",")}}`;
}

export function canonicalize(value) {
	try {
		return canonicalPart(value, { characters: 0, nodes: 0, seen: new WeakSet() }, 0);
	} catch {
		return undefined;
	}
}

export function deepFreeze(value) {
	if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
