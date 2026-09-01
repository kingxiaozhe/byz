import { basename } from "node:path";
import { readCmRecoveryEvidence } from "./cm-evidence-reader.js";
import { readGitHead } from "./git-head.js";
import { reduceRecoveryEvidence, sanitizeTerminalText } from "./recovery-state.js";

const USAGE = "Usage: /project [status|details|dismiss]";
const WARNING = "Project recovery is unavailable for this session.";
const NEXT_ENTRY_LABEL = "Next CM entry";
const SESSION_REASONS = new Set(["startup", "reload", "new", "resume", "fork"]);
const EVIDENCE_SEGMENT = /^[A-Za-z0-9._-]+$/u;
const DEGRADATION_REASONS = new Set([
	"candidate_limit",
	"content_limit",
	"invalid_input",
	"invalid_record",
	"io_error",
	"missing_source",
	"no_nofollow",
	"reader_failure",
	"reducer_failure",
	"renderer_failure",
	"review_limit",
	"schedule_failure",
	"session_failure",
	"size_limit",
	"source_changed",
	"unsafe_path",
]);
const FIELD_LIMITS = Object.freeze({
	project: 80,
	feature: 120,
	task: 48,
	node: 32,
	state: 32,
	status: 32,
	nextEntry: 48,
	reason: 48,
	path: 240,
	verdict: 32,
	head: 12,
});

function field(value, limit) {
	return sanitizeTerminalText(typeof value === "string" ? value : "", limit);
}

function isRelativeEvidencePath(value) {
	if (typeof value !== "string" || value.startsWith("/") || value.includes("\\")) return false;
	const segments = value.split("/");
	return (
		segments.length > 0 &&
		segments.every((segment) => !["", ".", ".."].includes(segment) && EVIDENCE_SEGMENT.test(segment))
	);
}

function sanitizeRenderInput({ project, projection, session, receipt, git }) {
	const historicalReviews = Array.isArray(projection?.historicalReviews)
		? projection.historicalReviews.slice(0, 4).map((review) =>
				Object.freeze({
					task: field(review?.task, FIELD_LIMITS.task),
					verdict: field(review?.verdict, FIELD_LIMITS.verdict),
				}),
			)
		: [];
	const sources = Array.isArray(receipt?.sources)
		? receipt.sources
				.filter((source) => isRelativeEvidencePath(source?.relativePath))
				.slice(0, 32)
				.map((source) => Object.freeze({ relativePath: field(source.relativePath, FIELD_LIMITS.path) }))
		: [];
	return Object.freeze({
		project: field(project, FIELD_LIMITS.project),
		projection: Object.freeze({
			feature: field(projection?.feature, FIELD_LIMITS.feature),
			task: field(projection?.task, FIELD_LIMITS.task),
			node: field(projection?.node, FIELD_LIMITS.node),
			state: field(projection?.state, FIELD_LIMITS.state),
			status: field(projection?.status, FIELD_LIMITS.status),
			nextEntry: field(projection?.nextEntry, FIELD_LIMITS.nextEntry),
			historicalReviews: Object.freeze(historicalReviews),
		}),
		session: Object.freeze({
			reason: SESSION_REASONS.has(session?.reason) ? session.reason : undefined,
			hasHistory: session?.hasHistory === true,
		}),
		receipt: Object.freeze({ sources: Object.freeze(sources) }),
		git: typeof git === "string" && /^[0-9a-f]{12}$/u.test(git) ? git : undefined,
	});
}

function renderCompactCard({ project, projection, session }) {
	const lines = [
		"Project recovery",
		`Project: ${field(project, FIELD_LIMITS.project)}`,
		`Feature: ${field(projection.feature ?? "unavailable", FIELD_LIMITS.feature)}`,
		`Task: ${field(projection.task ?? "unavailable", FIELD_LIMITS.task)}`,
		`CM: ${field(projection.node ?? "unavailable", FIELD_LIMITS.node)} / ${field(projection.state ?? "unavailable", FIELD_LIMITS.state)}`,
		`Status: ${field(projection.status, FIELD_LIMITS.status)}`,
		`Session: ${field(session.reason, FIELD_LIMITS.reason)} / ${session.hasHistory ? "history" : "no history"}`,
		`${NEXT_ENTRY_LABEL}: ${field(projection.nextEntry ?? "review status", FIELD_LIMITS.nextEntry)}`,
	];
	return lines.join("\n");
}

function renderDetailsCard(input) {
	const lines = [renderCompactCard(input)];
	const git = typeof input.git === "string" && /^[0-9a-f]{12}$/u.test(input.git) ? input.git : "unavailable";
	lines.push(`Current HEAD: ${git}`);
	const sources = Array.isArray(input.receipt?.sources)
		? input.receipt.sources.filter((source) => isRelativeEvidencePath(source?.relativePath))
		: [];
	lines.push("Evidence:");
	if (sources.length === 0) lines.push("- unavailable");
	for (const source of sources) lines.push(`- ${field(source.relativePath, FIELD_LIMITS.path)}`);
	lines.push("Historical review (not revalidated):");
	const historicalReviews = Array.isArray(input.projection.historicalReviews)
		? input.projection.historicalReviews
		: [];
	if (historicalReviews.length === 0) lines.push("- none");
	for (const review of historicalReviews) {
		lines.push(
			`- ${field(review.task, FIELD_LIMITS.task)}: ${field(review.verdict, FIELD_LIMITS.verdict)} (not revalidated)`,
		);
	}
	return lines.join("\n");
}

function fixedReason(result) {
	return DEGRADATION_REASONS.has(result?.reasonCode) ? result.reasonCode : "unknown";
}

export function createRecoveryExtension(options = {}) {
	const readEvidence = options.readEvidence ?? readCmRecoveryEvidence;
	const reduceEvidence = options.reduceEvidence ?? reduceRecoveryEvidence;
	const gitReader = options.readGitHead ?? readGitHead;
	const compactRenderer = options.renderCompact ?? renderCompactCard;
	const detailsRenderer = options.renderDetails ?? renderDetailsCard;
	const degrade = options.onDegrade ?? (() => {});
	const schedule = options.schedule ?? queueMicrotask;

	return Object.freeze(function recoveryExtension(ports) {
		let generation = 0;
		let dismissed = false;
		let warned = false;
		let autoShown = false;
		let sessionReason;

		const invalidate = () => {
			generation += 1;
		};

		const isTrusted = (ctx) => {
			try {
				return ctx.isProjectTrusted() === true;
			} catch {
				return false;
			}
		};

		const reportFailure = (ctx, reasonCode) => {
			try {
				degrade(fixedReason({ reasonCode }));
			} catch {}
			if (warned) return;
			warned = true;
			try {
				ctx.ui.notify(WARNING, "warning");
			} catch {}
		};

		const revokeIfUntrusted = (ctx) => {
			if (isTrusted(ctx)) return false;
			invalidate();
			return true;
		};

		const begin = () => {
			generation += 1;
			return generation;
		};

		const current = (operationGeneration, ctx) => {
			if (operationGeneration !== generation) return false;
			return !revokeIfUntrusted(ctx) && operationGeneration === generation;
		};

		const notify = (ctx, message) => {
			try {
				ctx.ui.notify(message, "info");
				return true;
			} catch {
				reportFailure(ctx, "renderer_failure");
				return false;
			}
		};

		const run = async (ctx, mode, automatic = false, operationGeneration = begin()) => {
			if (operationGeneration !== generation) return;
			if (revokeIfUntrusted(ctx)) return;
			let result;
			try {
				result = await readEvidence({ projectRoot: ctx.cwd, isTrusted: true });
			} catch {
				if (current(operationGeneration, ctx)) reportFailure(ctx, "reader_failure");
				return;
			}
			if (!current(operationGeneration, ctx)) return;
			if (result?.state === "absent" || result?.state === "not-eligible") return;
			if (result?.state !== "found") {
				reportFailure(ctx, fixedReason(result));
				return;
			}
			let projection;
			try {
				projection = reduceEvidence(result.value);
			} catch {
				reportFailure(ctx, "reducer_failure");
				return;
			}
			if (!current(operationGeneration, ctx)) return;
			let sessionSummary;
			try {
				sessionSummary = ctx.readSessionSummary();
			} catch {
				reportFailure(ctx, "session_failure");
				return;
			}
			if (!current(operationGeneration, ctx) || sessionSummary === undefined) return;
			const input = sanitizeRenderInput({
				project: basename(ctx.cwd),
				projection,
				session: {
					reason: SESSION_REASONS.has(ctx.reason) ? ctx.reason : sessionReason,
					hasHistory: sessionSummary.hasHistory === true,
				},
				receipt: result.receipt,
			});
			if (mode === "compact") {
				try {
					if (notify(ctx, compactRenderer(input)) && automatic) autoShown = true;
				} catch {
					reportFailure(ctx, "renderer_failure");
				}
				return;
			}
			if (!current(operationGeneration, ctx)) return;
			let git;
			try {
				git = await gitReader(ctx.cwd);
			} catch {
				git = Object.freeze({ state: "unavailable", reasonCode: "git-unavailable" });
			}
			if (!current(operationGeneration, ctx)) return;
			try {
				notify(ctx, detailsRenderer(sanitizeRenderInput({ ...input, git })));
			} catch {
				reportFailure(ctx, "renderer_failure");
			}
		};

		ports.on("session_start", (_event, ctx) => {
			if (!isTrusted(ctx)) {
				invalidate();
				return;
			}
			if (SESSION_REASONS.has(ctx.reason)) sessionReason = ctx.reason;
			if (ctx.reason !== "reload") {
				invalidate();
				dismissed = false;
				warned = false;
				autoShown = false;
			}
			if (dismissed || autoShown) return;
			const operationGeneration = begin();
			try {
				schedule(() => {
					void run(ctx, "compact", true, operationGeneration);
				});
			} catch {
				reportFailure(ctx, "schedule_failure");
			}
		});

		ports.on("session_shutdown", () => {
			invalidate();
			sessionReason = undefined;
		});

		ports.registerCommand("project", {
			description: "Show trusted CM project recovery status",
			async handler(args, ctx) {
				const command = typeof args === "string" ? args.trim() : "";
				if (command !== "" && command !== "status" && command !== "details" && command !== "dismiss") {
					try {
						ctx.ui.notify(USAGE, "warning");
					} catch {}
					return;
				}
				if (revokeIfUntrusted(ctx)) return;
				if (command === "dismiss") {
					begin();
					dismissed = true;
					return;
				}
				await run(ctx, command === "details" ? "details" : "compact");
			},
		});
	});
}

export { WARNING as RECOVERY_WARNING, USAGE as PROJECT_USAGE };
