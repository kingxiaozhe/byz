const RECOVERY_STATUSES = new Set(["resumable", "needs-reconciliation", "needs-decision", "blocked", "unavailable"]);
const NEXT_ENTRIES = new Map([
	["cm-ai", "cm-ai"],
	["cm-prd", "cm-prd"],
	["cm-fix", "cm-fix"],
	["cm-refactor", "cm-refactor"],
]);
const SPEC_STATUSES = new Set(["generated", "awaiting_review", "approved", "changed"]);
const RUN_STATUSES = new Set(["running", "done"]);
const CM_STATES = new Set(["running", "paused_for_human", "blocked", "run_done"]);
const REVIEW_VERDICTS = new Set(["approved", "changes_requested", "blocked"]);
const REVIEW_AUTHORITY_KEYS = new Set(["task", "attempt", "round", "verdict", "handoff", "handoff_sha256"]);
const MANIFEST_ENTRY_KEYS = new Set(["path", "sha256"]);
const TASK_ID_PATTERN = /^T-[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const HANDOFF_PATTERN = /^(?!\.\.?$)[A-Za-z0-9][A-Za-z0-9._-]{0,158}\.json$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value, allowed) {
	return Object.keys(value).every((key) => allowed.has(key));
}

function isOptionalString(value) {
	return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value) {
	return value === undefined || typeof value === "boolean";
}

function isTimestamp(value) {
	return typeof value === "string" && (Number.isFinite(Date.parse(value)) || /^\d{2}:\d{2}:\d{2}$/u.test(value));
}

function optionalText(value, maxLength = 160) {
	return typeof value === "string" ? sanitizeTerminalText(value, maxLength) : undefined;
}

function safeManifestEntries(value) {
	if (value === undefined) return true;
	if (!Array.isArray(value) || value.length > 256) return false;
	return value.every(
		(entry) =>
			isRecord(entry) &&
			exactKeys(entry, MANIFEST_ENTRY_KEYS) &&
			typeof entry.path === "string" &&
			entry.path.length <= 512 &&
			/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/u.test(entry.path) &&
			SHA256_PATTERN.test(entry.sha256),
	);
}

export function sanitizeTerminalText(value, maxLength = 160) {
	if (typeof value !== "string" || !Number.isSafeInteger(maxLength) || maxLength < 1) return "";
	const cleaned = value
		.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/gu, "")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "")
		.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, " ")
		.replace(/\s+/gu, " ")
		.trim();
	const codePoints = [...cleaned];
	if (codePoints.length <= maxLength) return cleaned;
	return `${codePoints.slice(0, Math.max(0, maxLength - 1)).join("")}…`;
}

export function parseSpecsStatus(value) {
	if (
		!isRecord(value) ||
		!exactKeys(value, new Set(["schema_version", "status", "at", "features", "specFiles", "testCases"]))
	) {
		return undefined;
	}
	if (
		(value.schema_version !== undefined && value.schema_version !== 1) ||
		!SPEC_STATUSES.has(value.status) ||
		(value.at !== undefined && !isTimestamp(value.at))
	) {
		return undefined;
	}
	if (!safeManifestEntries(value.specFiles) || !safeManifestEntries(value.testCases)) return undefined;
	if (
		!Array.isArray(value.features) ||
		value.features.length > 64 ||
		!value.features.every((item) => typeof item === "string")
	) {
		return undefined;
	}
	const features = value.features.map((feature) => sanitizeTerminalText(feature, 120));
	if (features.some((feature) => feature.length === 0)) return undefined;
	return Object.freeze({ status: value.status, features: Object.freeze(features) });
}

export function parseCmStatus(value) {
	if (!isRecord(value) || !exactKeys(value, new Set(["node", "feature", "task", "detail", "state", "at"]))) {
		return undefined;
	}
	const task = value.task === null ? undefined : value.task;
	const state = value.state === "completed" ? "run_done" : value.state;
	if (
		typeof value.node !== "string" ||
		!CM_STATES.has(state) ||
		!isOptionalString(value.feature) ||
		!isOptionalString(task) ||
		!isOptionalString(value.detail) ||
		(value.at !== undefined && !isTimestamp(value.at)) ||
		(task !== undefined && !TASK_ID_PATTERN.test(task))
	) {
		return undefined;
	}
	const node = sanitizeTerminalText(value.node, 32);
	const feature = optionalText(value.feature, 120);
	const detail = optionalText(value.detail, 240);
	if (node.length === 0 || (value.feature !== undefined && feature?.length === 0)) return undefined;
	return Object.freeze({ node, feature, task, detail, state });
}

export function parseRunPointer(value) {
	if (
		!isRecord(value) ||
		!exactKeys(
			value,
			new Set(["schema_version", "run_id", "workflow", "status", "global_log", "global_written", "updated_at"]),
		)
	) {
		return undefined;
	}
	if (
		value.schema_version !== 1 ||
		typeof value.run_id !== "string" ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u.test(value.run_id) ||
		!RUN_STATUSES.has(value.status) ||
		!isOptionalString(value.workflow) ||
		(value.workflow !== undefined && !/^[a-z][a-z0-9-]{0,47}$/u.test(value.workflow)) ||
		!isOptionalString(value.global_log) ||
		(value.global_log !== undefined && (value.global_log.length > 4096 || value.global_log.includes("\0"))) ||
		!isOptionalBoolean(value.global_written) ||
		(value.updated_at !== undefined && !isTimestamp(value.updated_at))
	) {
		return undefined;
	}
	return Object.freeze({ runId: value.run_id, workflow: value.workflow, status: value.status });
}

export function parseTaskList(markdown) {
	if (typeof markdown !== "string" || Buffer.byteLength(markdown, "utf8") > 1_048_576) return undefined;
	const tasks = [];
	const ids = new Set();
	for (const line of markdown.split(/\r?\n/u)) {
		const match = /^- \[([ xX])\] (T-[A-Za-z0-9][A-Za-z0-9._-]*): (.+)$/u.exec(line);
		if (!match) {
			if (/^- \[[ xX]\] T-/u.test(line)) return undefined;
			continue;
		}
		if (ids.has(match[2])) return undefined;
		const title = sanitizeTerminalText(match[3], 160);
		if (title.length === 0) return undefined;
		ids.add(match[2]);
		tasks.push(Object.freeze({ id: match[2], completed: match[1].toLowerCase() === "x", title }));
		if (tasks.length > 512) return undefined;
	}
	return tasks.length > 0 ? Object.freeze(tasks) : undefined;
}

function inspectFrontmatterKey(line) {
	const colon = line.indexOf(":");
	if (colon < 0) return Object.freeze({ invalid: false, authorityKey: undefined });
	const rawKey = line.slice(0, colon).trim();
	if (
		rawKey.startsWith('"') ||
		rawKey.endsWith('"') ||
		rawKey.startsWith("'") ||
		rawKey.endsWith("'") ||
		rawKey.includes("\\")
	) {
		return Object.freeze({ invalid: true, authorityKey: undefined });
	}
	return Object.freeze({
		invalid: false,
		authorityKey: REVIEW_AUTHORITY_KEYS.has(rawKey) ? rawKey : undefined,
	});
}

export function parseReviewFrontmatter(markdown) {
	if (typeof markdown !== "string") return undefined;
	const normalized = markdown.replace(/\r\n/gu, "\n");
	if (!normalized.startsWith("---\n")) return undefined;
	const end = normalized.indexOf("\n---\n", 4);
	if (end < 0 || end > 16_384) return undefined;
	const fields = {};
	const seen = new Set();
	for (const line of normalized.slice(4, end).split("\n")) {
		if (/^[?:](?:\s|$)/u.test(line)) return undefined;
		const inspected = inspectFrontmatterKey(line);
		if (inspected.invalid) return undefined;
		if (!inspected.authorityKey) continue;
		const canonical = new RegExp(`^${inspected.authorityKey}: ([^\\n]*)$`, "u").exec(line);
		if (!canonical || seen.has(inspected.authorityKey)) return undefined;
		seen.add(inspected.authorityKey);
		fields[inspected.authorityKey] = canonical[1].trim();
	}
	if (seen.size !== REVIEW_AUTHORITY_KEYS.size) return undefined;
	if (!TASK_ID_PATTERN.test(fields.task) || !REVIEW_VERDICTS.has(fields.verdict)) return undefined;
	const attempt = Number(fields.attempt);
	const round = Number(fields.round);
	if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 2 || round !== attempt) return undefined;
	if (!HANDOFF_PATTERN.test(fields.handoff) || !SHA256_PATTERN.test(fields.handoff_sha256)) return undefined;
	return Object.freeze({
		task: fields.task,
		attempt,
		verdict: fields.verdict,
		handoff: fields.handoff,
		historical: true,
		validation: "not-revalidated",
	});
}

function reasonForState(status) {
	switch (status) {
		case "blocked":
			return "cm_review_blocked";
		case "needs-decision":
			return "cm_user_decision_required";
		case "needs-reconciliation":
			return "cm_evidence_conflict";
		case "resumable":
			return "cm_work_resumable";
		default:
			return "cm_state_unavailable";
	}
}

function validSpecsProjection(value) {
	return (
		isRecord(value) &&
		exactKeys(value, new Set(["status", "features"])) &&
		SPEC_STATUSES.has(value.status) &&
		Array.isArray(value.features) &&
		value.features.length <= 64 &&
		value.features.every((feature) => typeof feature === "string" && feature.length > 0)
	);
}

function validStatusProjection(value) {
	return (
		isRecord(value) &&
		exactKeys(value, new Set(["node", "feature", "task", "detail", "state"])) &&
		typeof value.node === "string" &&
		value.node.length > 0 &&
		isOptionalString(value.feature) &&
		(value.task === undefined || (typeof value.task === "string" && TASK_ID_PATTERN.test(value.task))) &&
		isOptionalString(value.detail) &&
		CM_STATES.has(value.state)
	);
}

function validRunProjection(value) {
	return (
		isRecord(value) &&
		exactKeys(value, new Set(["runId", "workflow", "status"])) &&
		typeof value.runId === "string" &&
		/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u.test(value.runId) &&
		isOptionalString(value.workflow) &&
		RUN_STATUSES.has(value.status)
	);
}

function validTaskProjection(value) {
	return (
		isRecord(value) &&
		exactKeys(value, new Set(["id", "completed", "title"])) &&
		TASK_ID_PATTERN.test(value.id) &&
		typeof value.completed === "boolean" &&
		typeof value.title === "string" &&
		value.title.length > 0
	);
}

function validReviewProjection(value) {
	return (
		isRecord(value) &&
		exactKeys(value, new Set(["task", "attempt", "verdict", "handoff", "historical", "validation"])) &&
		TASK_ID_PATTERN.test(value.task) &&
		Number.isSafeInteger(value.attempt) &&
		value.attempt >= 1 &&
		value.attempt <= 2 &&
		REVIEW_VERDICTS.has(value.verdict) &&
		HANDOFF_PATTERN.test(value.handoff) &&
		value.historical === true &&
		value.validation === "not-revalidated"
	);
}

export function reduceRecoveryEvidence(input) {
	if (!isRecord(input)) return Object.freeze({ status: "unavailable", reasonCode: "cm_state_unavailable" });
	const candidateCountValid =
		Number.isSafeInteger(input.candidateCount) && input.candidateCount >= 0 && input.candidateCount <= 64;
	if (candidateCountValid && input.candidateCount > 1) {
		return Object.freeze({ status: "needs-decision", reasonCode: "cm_user_decision_required" });
	}
	const flagsValid = ["identityConflict", "completionEvidenceMissing", "taskReviewConflict"].every(
		(key) => input[key] === undefined || typeof input[key] === "boolean",
	);
	const sourceStateValid =
		input.sourceState === undefined || input.sourceState === "available" || input.sourceState === "unavailable";
	const tasksContainerValid = Array.isArray(input.tasks);
	const reviewsContainerValid = Array.isArray(input.reviews);
	const tasksInput = tasksContainerValid ? input.tasks : [];
	const reviewsInput = reviewsContainerValid ? input.reviews : [];
	const sourcesValid =
		candidateCountValid &&
		input.candidateCount === 1 &&
		flagsValid &&
		sourceStateValid &&
		validSpecsProjection(input.specsStatus) &&
		validStatusProjection(input.cmStatus) &&
		validRunProjection(input.run) &&
		tasksContainerValid &&
		tasksInput.length <= 512 &&
		tasksInput.every(validTaskProjection) &&
		reviewsContainerValid &&
		reviewsInput.length <= 4 &&
		reviewsInput.every(validReviewProjection);
	const tasks = sourcesValid ? tasksInput : [];
	const reviews = sourcesValid ? reviewsInput : [];
	const statusTask =
		sourcesValid && input.cmStatus.task ? tasks.find((task) => task.id === input.cmStatus.task) : undefined;
	const incompleteTasks = tasks.filter((task) => task.completed === false);
	const inferredTask =
		input.cmStatus?.task === undefined && incompleteTasks.length === 1 ? incompleteTasks[0] : undefined;
	const currentTask = statusTask ?? inferredTask;
	const activeTaskId = sourcesValid ? (input.cmStatus.task ?? currentTask?.id) : undefined;
	const activeReviews = reviews
		.filter((review) => review.task === activeTaskId)
		.toSorted((left, right) => left.attempt - right.attempt);
	const duplicateAttemptConflict = activeReviews.some(
		(review, index) => activeReviews[index + 1]?.attempt === review.attempt,
	);
	const reviewTaskConflict = sourcesValid && reviews.some((review) => review.task !== activeTaskId);
	const statusTaskConflict =
		sourcesValid && input.cmStatus.task !== undefined && (!statusTask || statusTask.completed);
	const ambiguousTaskConflict = sourcesValid && input.cmStatus.task === undefined && incompleteTasks.length > 1;
	const lifecycleConflict =
		sourcesValid &&
		((input.run.status === "running" && input.cmStatus.state === "run_done") ||
			(input.run.status === "done" && input.cmStatus.state === "running"));
	const knownConflict =
		input.identityConflict === true ||
		input.completionEvidenceMissing === true ||
		input.taskReviewConflict === true ||
		duplicateAttemptConflict ||
		reviewTaskConflict ||
		statusTaskConflict ||
		ambiguousTaskConflict ||
		lifecycleConflict;
	const latestReview = activeReviews.at(-1);
	let status;
	if (knownConflict) {
		status = "needs-reconciliation";
	} else if (input.sourceState === "unavailable" || !sourcesValid) {
		status = "unavailable";
	} else if (latestReview?.verdict === "blocked" || input.cmStatus.state === "blocked") {
		status = "blocked";
	} else if (input.specsStatus.status === "awaiting_review" || input.cmStatus.state === "paused_for_human") {
		status = "needs-decision";
	} else if (input.run.status === "running" && currentTask && !currentTask.completed) {
		status = "resumable";
	} else if (input.run.status === "done" && currentTask && !currentTask.completed) {
		status = "needs-reconciliation";
	} else {
		status = "unavailable";
	}
	if (!RECOVERY_STATUSES.has(status)) status = "unavailable";
	const workflow = sourcesValid ? input.run.workflow : undefined;
	const nextEntry = status === "resumable" || status === "needs-decision" ? NEXT_ENTRIES.get(workflow) : undefined;
	return Object.freeze({
		status,
		reasonCode: reasonForState(status),
		feature: sourcesValid ? optionalText(input.cmStatus.feature, 120) : undefined,
		task: optionalText(activeTaskId, 48),
		node: sourcesValid ? optionalText(input.cmStatus.node, 32) : undefined,
		state: sourcesValid ? input.cmStatus.state : undefined,
		summary: sourcesValid ? optionalText(input.cmStatus.detail, 240) : undefined,
		nextEntry,
		historicalReviews: Object.freeze(
			latestReview
				? [
						Object.freeze({
							task: latestReview.task,
							verdict: latestReview.verdict,
							validation: "not-revalidated",
						}),
					]
				: [],
		),
	});
}
