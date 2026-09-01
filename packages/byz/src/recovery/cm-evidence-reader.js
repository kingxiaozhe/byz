import { lstat, open, opendir, realpath } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import {
	parseCmStatus,
	parseReviewFrontmatter,
	parseRunPointer,
	parseSpecsStatus,
	parseTaskList,
} from "./recovery-state.js";
import {
	inspectDirectoryBoundary,
	isContainedPath,
	readBoundedRegularFile,
	revalidateDirectoryBoundary,
} from "./safe-read.js";

const DEFAULT_FS = Object.freeze({ lstat, open, opendir, realpath });
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const DEFAULT_LIMITS = Object.freeze({
	candidateCount: 64,
	reviewCount: 4,
	stateFileBytes: 1_048_576,
	reviewFileBytes: 524_288,
	snapshotBytes: 4_194_304,
});
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const REVIEW_HEADER_READ_BYTES = 32_768;
const LF_FRONTMATTER_END = Buffer.from("\n---\n");
const CRLF_FRONTMATTER_END = Buffer.from("\r\n---\r\n");

function validateLimits(limits) {
	return (
		Number.isSafeInteger(limits.candidateCount) &&
		limits.candidateCount >= 1 &&
		limits.candidateCount <= DEFAULT_LIMITS.candidateCount &&
		Number.isSafeInteger(limits.reviewCount) &&
		limits.reviewCount >= 1 &&
		limits.reviewCount <= DEFAULT_LIMITS.reviewCount &&
		Number.isSafeInteger(limits.stateFileBytes) &&
		limits.stateFileBytes >= 1 &&
		limits.stateFileBytes <= DEFAULT_LIMITS.stateFileBytes &&
		Number.isSafeInteger(limits.reviewFileBytes) &&
		limits.reviewFileBytes >= 1 &&
		limits.reviewFileBytes <= DEFAULT_LIMITS.reviewFileBytes &&
		Number.isSafeInteger(limits.snapshotBytes) &&
		limits.snapshotBytes >= 1 &&
		limits.snapshotBytes <= DEFAULT_LIMITS.snapshotBytes
	);
}

function decode(bytes) {
	try {
		return textDecoder.decode(bytes);
	} catch {
		return undefined;
	}
}

function parseJson(bytes, parser) {
	const text = decode(bytes);
	if (text === undefined) return undefined;
	try {
		return parser(JSON.parse(text));
	} catch {
		return undefined;
	}
}

function sourceFailure(result) {
	if (result.state === "rejected" || result.state === "unavailable") return result;
	return { state: "unavailable", reasonCode: "missing_source" };
}

function selectReviewHeader(bytes) {
	const lfEnd = bytes.indexOf(LF_FRONTMATTER_END, 4);
	const crlfEnd = bytes.indexOf(CRLF_FRONTMATTER_END, 5);
	const ends = [
		lfEnd < 0 ? undefined : lfEnd + LF_FRONTMATTER_END.length,
		crlfEnd < 0 ? undefined : crlfEnd + CRLF_FRONTMATTER_END.length,
	].filter((value) => value !== undefined);
	if (ends.length === 0) return undefined;
	return bytes.subarray(0, Math.min(...ends));
}

async function readSource(context, path, relativePath, maxBytes, options = {}) {
	const result = await readBoundedRegularFile({
		fs: context.fs,
		path,
		allowedRoot: context.project.path,
		relativePath,
		maxBytes,
		budget: context.budget,
		...options,
	});
	if (result.state === "found") context.receipts.push(result.receipt);
	return result;
}

async function listDirectDirectories(fs, specs, limit) {
	const directories = [];
	try {
		const directory = await fs.opendir(specs.path);
		for await (const entry of directory) {
			if (entry.isSymbolicLink()) return { state: "rejected", reasonCode: "unsafe_path" };
			if (!entry.isDirectory()) continue;
			if (!SEGMENT_PATTERN.test(entry.name) || basename(entry.name) !== entry.name) {
				return { state: "rejected", reasonCode: "unsafe_path" };
			}
			directories.push(entry.name);
			if (directories.length > limit) return { state: "rejected", reasonCode: "candidate_limit" };
		}
		return { state: "found", directories: directories.toSorted() };
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return { state: "absent" };
		}
		return { state: "unavailable", reasonCode: "io_error" };
	}
}

async function listCurrentReviews(context, candidate, task) {
	if (task === undefined) return { state: "found", reviews: [], boundaries: [] };
	const reviewsPath = join(candidate.path, ".reviews");
	const boundary = await inspectDirectoryBoundary(context.fs, reviewsPath, candidate.path);
	if (boundary.state === "absent") return { state: "found", reviews: [], boundaries: [] };
	if (boundary.state !== "found") return boundary;
	const escapedTask = task.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	const filePattern = new RegExp(`-${escapedTask}-r[0-9]+\\.md$`, "u");
	const names = [];
	try {
		const directory = await context.fs.opendir(boundary.path);
		for await (const entry of directory) {
			if (!filePattern.test(entry.name)) continue;
			if (entry.isSymbolicLink() || !entry.isFile()) return { state: "rejected", reasonCode: "unsafe_path" };
			names.push(entry.name);
			if (names.length > context.limits.reviewCount) {
				return { state: "rejected", reasonCode: "review_limit" };
			}
		}
	} catch {
		return { state: "unavailable", reasonCode: "io_error" };
	}
	const reviews = [];
	for (const name of names.toSorted()) {
		const relativePath = relative(context.project.path, join(boundary.path, name)).split(sep).join("/");
		const source = await readSource(
			context,
			join(boundary.path, name),
			relativePath,
			context.limits.reviewFileBytes,
			{
				readLimit: REVIEW_HEADER_READ_BYTES,
				projectBytes: selectReviewHeader,
			},
		);
		if (source.state !== "found") return sourceFailure(source);
		const text = decode(source.bytes);
		const parsed = text === undefined ? undefined : parseReviewFrontmatter(text);
		if (parsed === undefined) return { state: "unavailable", reasonCode: "invalid_record" };
		reviews.push(parsed);
	}
	return { state: "found", reviews: Object.freeze(reviews), boundaries: [boundary] };
}

async function readCandidate(context, name) {
	const candidatePath = join(context.specs.path, name);
	const candidate = await inspectDirectoryBoundary(context.fs, candidatePath, context.specs.path);
	if (candidate.state !== "found") return candidate;
	if (
		!isContainedPath(context.specs.path, candidate.path) ||
		relative(context.specs.path, candidate.path).includes(sep)
	) {
		return { state: "rejected", reasonCode: "unsafe_path" };
	}
	const runSource = await readSource(
		context,
		join(candidate.path, ".cm-run.json"),
		relative(context.project.path, join(candidate.path, ".cm-run.json")).split(sep).join("/"),
		context.limits.stateFileBytes,
	);
	if (runSource.state === "absent") return { state: "absent" };
	if (runSource.state !== "found") return sourceFailure(runSource);
	const run = parseJson(runSource.bytes, parseRunPointer);
	if (run === undefined) return { state: "unavailable", reasonCode: "invalid_record" };
	const core = [
		[".cm-specs-status", parseSpecsStatus],
		[".cm-status.json", parseCmStatus],
	];
	const parsed = [];
	for (const [fileName, parser] of core) {
		const source = await readSource(
			context,
			join(candidate.path, fileName),
			relative(context.project.path, join(candidate.path, fileName)).split(sep).join("/"),
			context.limits.stateFileBytes,
		);
		if (source.state !== "found") return sourceFailure(source);
		const value = parseJson(source.bytes, parser);
		if (value === undefined) return { state: "unavailable", reasonCode: "invalid_record" };
		parsed.push(value);
	}
	const [specsStatus, cmStatus] = parsed;
	const feature = cmStatus.feature ?? (specsStatus.features.length === 1 ? specsStatus.features[0] : undefined);
	if (feature === undefined || !SEGMENT_PATTERN.test(feature)) {
		return { state: "unavailable", reasonCode: "invalid_record" };
	}
	const featureBoundary = await inspectDirectoryBoundary(context.fs, join(candidate.path, feature), candidate.path);
	if (featureBoundary.state !== "found") return sourceFailure(featureBoundary);
	const tasksSource = await readSource(
		context,
		join(featureBoundary.path, "tasks.md"),
		relative(context.project.path, join(featureBoundary.path, "tasks.md")).split(sep).join("/"),
		context.limits.stateFileBytes,
	);
	if (tasksSource.state !== "found") return sourceFailure(tasksSource);
	const tasksText = decode(tasksSource.bytes);
	const tasks = tasksText === undefined ? undefined : parseTaskList(tasksText);
	if (tasks === undefined) return { state: "unavailable", reasonCode: "invalid_record" };
	const incompleteTasks = tasks.filter((task) => !task.completed);
	const currentTask = cmStatus.task ?? (incompleteTasks.length === 1 ? incompleteTasks[0].id : undefined);
	const reviewResult = await listCurrentReviews(context, candidate, currentTask);
	if (reviewResult.state !== "found") return reviewResult;
	const latestReview = reviewResult.reviews.toSorted((left, right) => left.attempt - right.attempt).at(-1);
	const currentTaskRecord = tasks.find((task) => task.id === currentTask);
	const actionable =
		run.status === "running" ||
		specsStatus.status === "awaiting_review" ||
		cmStatus.state === "paused_for_human" ||
		cmStatus.state === "blocked" ||
		(currentTaskRecord !== undefined && !currentTaskRecord.completed) ||
		(latestReview !== undefined && latestReview.verdict !== "approved");
	if (!actionable) return { state: "absent" };
	return {
		state: "found",
		value: Object.freeze({ specsStatus, cmStatus, run, tasks, reviews: reviewResult.reviews }),
		boundaries: [candidate, featureBoundary, ...reviewResult.boundaries],
	};
}

export async function readCmRecoveryEvidence({
	projectRoot,
	isTrusted,
	fs = DEFAULT_FS,
	limits = DEFAULT_LIMITS,
} = {}) {
	if (isTrusted !== true) return Object.freeze({ state: "not-eligible" });
	if (typeof projectRoot !== "string" || projectRoot.length === 0 || !validateLimits(limits)) {
		return Object.freeze({ state: "unavailable", reasonCode: "invalid_input" });
	}
	const project = await inspectDirectoryBoundary(fs, projectRoot);
	if (project.state !== "found") return Object.freeze(project);
	const specs = await inspectDirectoryBoundary(fs, join(project.path, "specs"), project.path);
	if (specs.state === "absent") return Object.freeze({ state: "absent" });
	if (specs.state !== "found") return Object.freeze(specs);
	const listed = await listDirectDirectories(fs, specs, limits.candidateCount);
	if (listed.state !== "found") return Object.freeze(listed);
	const context = { fs, limits, project, specs, budget: { remaining: limits.snapshotBytes }, receipts: [] };
	const candidates = [];
	const boundaries = [project, specs];
	for (const name of listed.directories) {
		const candidate = await readCandidate(context, name);
		if (candidate.state === "absent") continue;
		if (candidate.state !== "found") return Object.freeze(candidate);
		candidates.push(candidate.value);
		boundaries.push(...candidate.boundaries);
	}
	if (candidates.length === 0) return Object.freeze({ state: "absent" });
	for (const boundary of boundaries) {
		if (!(await revalidateDirectoryBoundary(fs, boundary))) {
			return Object.freeze({ state: "rejected", reasonCode: "source_changed" });
		}
	}
	if (candidates.length > 1) {
		return Object.freeze({
			state: "found",
			value: Object.freeze({ candidateCount: candidates.length }),
			receipt: Object.freeze({
				projectIdentity: project.identity,
				specsIdentity: specs.identity,
				runId: "multiple",
				sources: Object.freeze(context.receipts),
			}),
		});
	}
	return Object.freeze({
		state: "found",
		value: Object.freeze({ ...candidates[0], candidateCount: 1 }),
		receipt: Object.freeze({
			projectIdentity: project.identity,
			specsIdentity: specs.identity,
			runId: candidates[0].run.runId,
			sources: Object.freeze(context.receipts),
		}),
	});
}

export { DEFAULT_LIMITS as RECOVERY_READER_LIMITS };
