import assert from "node:assert/strict";
import test from "node:test";

import { createRecoveryExtension, PROJECT_USAGE, RECOVERY_WARNING } from "../src/recovery/recovery-extension.js";

const receipt = Object.freeze({
	sources: Object.freeze([
		Object.freeze({ relativePath: "specs/demo/.cm-status.json" }),
		Object.freeze({ relativePath: "specs/demo/.reviews/demo-T-006-r1.md" }),
	]),
});

function evidence(overrides = {}) {
	return Object.freeze({
		candidateCount: 1,
		specsStatus: Object.freeze({ status: "approved", features: Object.freeze(["1.recovery"]) }),
		cmStatus: Object.freeze({ node: "N3", feature: "1.recovery", task: "T-006", state: "running" }),
		run: Object.freeze({ runId: "run-1", workflow: "cm-ai", status: "running" }),
		tasks: Object.freeze([Object.freeze({ id: "T-006", completed: false, title: "extension" })]),
		reviews: Object.freeze([
			Object.freeze({
				task: "T-006",
				attempt: 1,
				verdict: "approved",
				handoff: "handoff.json",
				historical: true,
				validation: "not-revalidated",
			}),
		]),
		...overrides,
	});
}

function found(value = evidence()) {
	return Object.freeze({ state: "found", value, receipt });
}

function harness(options = {}) {
	const handlers = new Map();
	const commands = new Map();
	const notices = [];
	let trusted = options.trusted ?? true;
	let sessionReads = 0;
	const ctx = {
		cwd: "/trusted/demo-project",
		reason: "startup",
		isProjectTrusted() {
			options.onTrustCheck?.();
			return trusted;
		},
		readSessionSummary() {
			sessionReads += 1;
			return { hasHistory: true };
		},
		ui: {
			notify(message, level) {
				if (options.notifyThrows) throw new Error("raw notify failure");
				notices.push({ message, level });
			},
		},
	};
	const ports = {
		on(name, handler) {
			handlers.set(name, handler);
			return Object.freeze({ dispose() {} });
		},
		registerCommand(name, command) {
			commands.set(name, command);
		},
	};
	createRecoveryExtension(options)(ports);
	return {
		commands,
		ctx,
		handlers,
		notices,
		get sessionReads() {
			return sessionReads;
		},
		setTrusted(value) {
			trusted = value;
		},
	};
}

async function settle() {
	await new Promise((resolve) => setImmediate(resolve));
}

test("session_start returns before CM I/O and allows the welcome notification first", async () => {
	const order = [];
	const h = harness({
		readEvidence: async () => {
			order.push("read");
			return found();
		},
	});
	const result = h.handlers.get("session_start")({}, h.ctx);
	order.push("welcome");
	assert.equal(result, undefined);
	assert.deepEqual(order, ["welcome"]);
	await settle();
	assert.deepEqual(order, ["welcome", "read"]);
	assert.match(h.notices[0].message, /^Project recovery/u);
});

test("five session reasons project safely and reload never duplicates the automatic card", async () => {
	for (const reason of ["startup", "new", "resume", "fork", "reload"]) {
		const h = harness({ readEvidence: async () => found() });
		h.ctx.reason = reason;
		h.handlers.get("session_start")({}, h.ctx);
		await settle();
		assert.match(h.notices[0].message, new RegExp(`Session: ${reason} / history`, "u"));
		h.ctx.reason = "reload";
		h.handlers.get("session_start")({}, h.ctx);
		await settle();
		assert.equal(h.notices.length, 1, reason);
	}
});

test("manual commands retain the current session reason from session_start context", async () => {
	const h = harness({ readEvidence: async () => found() });
	h.ctx.reason = "resume";
	h.handlers.get("session_start")({}, h.ctx);
	await settle();
	h.notices.length = 0;
	h.ctx.reason = undefined;
	await h.commands.get("project").handler("status", h.ctx);
	assert.match(h.notices[0].message, /Session: resume \/ history/u);
});

test("dismiss is session-only, status remains manual, and a new session resets automatic state", async () => {
	let reads = 0;
	const h = harness({
		readEvidence: async () => {
			reads += 1;
			return found();
		},
	});
	await h.commands.get("project").handler("dismiss", h.ctx);
	h.ctx.reason = "reload";
	h.handlers.get("session_start")({}, h.ctx);
	await settle();
	assert.equal(reads, 0);
	await h.commands.get("project").handler("status", h.ctx);
	assert.equal(reads, 1);
	h.ctx.reason = "new";
	h.handlers.get("session_start")({}, h.ctx);
	await settle();
	assert.equal(reads, 2);
});

test("unknown arguments show fixed usage without echoing or reading evidence", async () => {
	let reads = 0;
	const h = harness({
		readEvidence: async () => {
			reads += 1;
			return found();
		},
	});
	await h.commands.get("project").handler("evil\n/path --force", h.ctx);
	assert.equal(reads, 0);
	assert.deepEqual(h.notices, [{ message: PROJECT_USAGE, level: "warning" }]);
	assert.doesNotMatch(h.notices[0].message, /evil|path|force/u);
});

test("untrusted startup and commands perform zero CM, Session, and Git reads", async () => {
	let cmReads = 0;
	let gitReads = 0;
	const h = harness({
		trusted: false,
		readEvidence: async () => {
			cmReads += 1;
			return found();
		},
		readGitHead: async () => {
			gitReads += 1;
			return "0123456789ab";
		},
	});
	h.handlers.get("session_start")({}, h.ctx);
	await h.commands.get("project").handler("status", h.ctx);
	await h.commands.get("project").handler("details", h.ctx);
	await h.commands.get("project").handler("dismiss", h.ctx);
	await settle();
	assert.deepEqual(
		{ cmReads, gitReads, sessionReads: h.sessionReads, notices: h.notices.length },
		{
			cmReads: 0,
			gitReads: 0,
			sessionReads: 0,
			notices: 0,
		},
	);
});

test("trust revocation and newer generations make pending results inert", async () => {
	let resolveFirst;
	let calls = 0;
	const h = harness({
		readEvidence: () => {
			calls += 1;
			if (calls === 1) {
				return new Promise((resolve) => {
					resolveFirst = resolve;
				});
			}
			return Promise.resolve(found(evidence({ cmStatus: { ...evidence().cmStatus, node: "N4" } })));
		},
	});
	const first = h.commands.get("project").handler("status", h.ctx);
	const second = h.commands.get("project").handler("status", h.ctx);
	resolveFirst(found(evidence({ cmStatus: { ...evidence().cmStatus, node: "OLD" } })));
	await Promise.all([first, second]);
	assert.equal(h.notices.length, 1);
	assert.match(h.notices[0].message, /CM: N4/u);
	assert.doesNotMatch(h.notices[0].message, /OLD/u);

	let release;
	const revoked = harness({
		readEvidence: () =>
			new Promise((resolve) => {
				release = resolve;
			}),
	});
	const pending = revoked.commands.get("project").handler("status", revoked.ctx);
	revoked.setTrusted(false);
	release(found());
	await pending;
	assert.equal(revoked.notices.length, 0);
});

test("shutdown invalidates an automatic read before its scheduled microtask starts", async () => {
	let reads = 0;
	const h = harness({
		readEvidence: async () => {
			reads += 1;
			return found();
		},
	});
	h.handlers.get("session_start")({}, h.ctx);
	h.handlers.get("session_shutdown")({}, h.ctx);
	await settle();
	assert.equal(reads, 0);
	assert.equal(h.notices.length, 0);
});

test("startup, status, and dismiss use zero Git; details uses a second pre-Git trust check and one Git read", async () => {
	let gitReads = 0;
	let trustChecks = 0;
	const h = harness({
		onTrustCheck: () => {
			trustChecks += 1;
		},
		readEvidence: async () => found(),
		readGitHead: async () => {
			gitReads += 1;
			return "0123456789ab";
		},
	});
	h.handlers.get("session_start")({}, h.ctx);
	await settle();
	await h.commands.get("project").handler("status", h.ctx);
	await h.commands.get("project").handler("dismiss", h.ctx);
	assert.equal(gitReads, 0);
	const before = trustChecks;
	await h.commands.get("project").handler("details", h.ctx);
	assert.equal(gitReads, 1);
	assert.ok(trustChecks - before >= 4);
	assert.match(h.notices.at(-1).message, /Current HEAD: 0123456789ab/u);
});

test("details rechecks trust immediately before Git and skips Git when revoked", async () => {
	let gitReads = 0;
	let checks = 0;
	const h = harness({
		onTrustCheck() {
			checks += 1;
			if (checks === 4) h.setTrusted(false);
		},
		readEvidence: async () => found(),
		readGitHead: async () => {
			gitReads += 1;
			return "0123456789ab";
		},
	});
	await h.commands.get("project").handler("details", h.ctx);
	assert.equal(gitReads, 0);
	assert.equal(h.notices.length, 0);
});

test("compact and details sanitize every rendered field and expose only relative receipts", async () => {
	const malicious = "\u001b[31mN4\u001b[0m\nFAKE\u202e";
	const dirty = evidence({
		cmStatus: Object.freeze({
			node: malicious,
			feature: `${malicious}${"x".repeat(300)}`,
			task: "T-006",
			state: "running",
		}),
	});
	const h = harness({ readEvidence: async () => found(dirty), readGitHead: async () => "0123456789ab" });
	await h.commands.get("project").handler("details", h.ctx);
	const output = h.notices[0].message;
	assert.doesNotMatch(output, /\u001b|\u202e/u);
	assert.match(output, /CM: N4 FAKE \/ running/u);
	assert.match(output, /specs\/demo\/\.cm-status\.json/u);
	assert.doesNotMatch(output, /\/trusted\/demo-project\/specs/u);
	assert.match(output, /T-006: approved \(not revalidated\)/u);
});

test("injected renderers receive only bounded sanitized projection data", async () => {
	const malicious = `\u001b[31mFAKE\n${"x".repeat(300)}\u202e`;
	let rendererInput;
	const h = harness({
		readEvidence: async () =>
			found(
				evidence({
					cmStatus: Object.freeze({ node: "N3", feature: malicious, task: "T-006", state: "running" }),
				}),
			),
		renderCompact(input) {
			rendererInput = input;
			return input.projection.feature;
		},
	});
	await h.commands.get("project").handler("status", h.ctx);
	assert.doesNotMatch(h.notices[0].message, /\u001b|\u202e|\n/u);
	assert.ok([...h.notices[0].message].length <= 120);
	assert.equal(Object.isFrozen(rendererInput), true);
	assert.equal(Object.isFrozen(rendererInput.projection), true);
});

test("details rejects forged Git and absolute evidence while tolerating decision-only projections", async () => {
	const h = harness({
		readEvidence: async () =>
			Object.freeze({
				state: "found",
				value: Object.freeze({ candidateCount: 2 }),
				receipt: Object.freeze({
					sources: Object.freeze([
						Object.freeze({ relativePath: "/private/secret" }),
						Object.freeze({ relativePath: "specs/../secret" }),
					]),
				}),
			}),
		readGitHead: async () => "not-a-commit",
	});
	await assert.doesNotReject(h.commands.get("project").handler("details", h.ctx));
	assert.match(h.notices[0].message, /Current HEAD: unavailable/u);
	assert.match(h.notices[0].message, /Evidence:\n- unavailable/u);
	assert.doesNotMatch(h.notices[0].message, /private|secret/u);
});

test("no candidate is silent", async () => {
	const h = harness({ readEvidence: async () => Object.freeze({ state: "absent" }) });
	h.handlers.get("session_start")({}, h.ctx);
	await settle();
	assert.equal(h.notices.length, 0);
});

test("reader, renderer, Git, callback, and notify failures never escape and warning is once per session", async () => {
	const reasons = [];
	let reads = 0;
	const h = harness({
		readEvidence: async () => {
			reads += 1;
			if (reads === 1) throw new Error("/secret/raw reader error");
			return Object.freeze({ state: "rejected", reasonCode: "unsafe_path" });
		},
		onDegrade(reason) {
			reasons.push(reason);
			throw new Error("diagnostics failure");
		},
	});
	await assert.doesNotReject(h.commands.get("project").handler("status", h.ctx));
	await assert.doesNotReject(h.commands.get("project").handler("status", h.ctx));
	assert.deepEqual(reasons, ["reader_failure", "unsafe_path"]);
	assert.deepEqual(h.notices, [{ message: RECOVERY_WARNING, level: "warning" }]);
	assert.doesNotMatch(h.notices[0].message, /secret|raw|unsafe_path/u);

	const renderer = harness({
		readEvidence: async () => found(),
		readGitHead: async () => {
			throw new Error("raw git output");
		},
		renderDetails() {
			throw new Error("raw renderer input");
		},
		notifyThrows: true,
	});
	await assert.doesNotReject(renderer.commands.get("project").handler("details", renderer.ctx));
});
