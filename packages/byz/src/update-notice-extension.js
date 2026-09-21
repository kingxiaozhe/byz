// Startup only reads the cached answer from disk, so it adds no network call and no measurable
// delay. The refresh runs after that line is already decided and its result is only ever seen by
// the next session; a failure leaves no trace.
import {
	formatUpdateNotice,
	readCachedRelease,
	resolveUpdateHome,
	shouldRefresh,
	updateCheckEnabled,
	writeCachedRelease,
} from "./update-notice.js";

export function createUpdateNoticeExtension(options = {}) {
	const currentVersion = options.currentVersion;
	const env = options.env ?? process.env;
	const home = options.home ?? resolveUpdateHome(env);
	const now = options.now ?? (() => Date.now());
	const readCache = options.readCache ?? readCachedRelease;
	const writeCache = options.writeCache ?? writeCachedRelease;
	const fetchLatest = options.fetchLatest;

	// A refresh still in flight must never hold the process open: Node keeps the event loop alive
	// for an open socket, so leaving it unattended delayed exit by the request timeout.
	let pending;

	const refresh = async (signal) => {
		if (!fetchLatest) return;
		try {
			const release = await fetchLatest(currentVersion, signal);
			writeCache({ checkedAt: now(), version: release?.version }, home);
		} catch {
			// The user asked for a coding agent, not a release check. Staying quiet is the feature.
			// Record the attempt anyway so a machine that can never reach the registry stops asking
			// on every launch; the version already on record stays untouched.
			writeCache({ checkedAt: now(), version: readCache(home)?.version ?? currentVersion }, home);
		}
	};

	return (ports) => {
		ports.on("session_start", (_event, ctx) => {
			if (!updateCheckEnabled(env)) return;
			let cached;
			try {
				cached = readCache(home);
				const notice = formatUpdateNotice(currentVersion, cached);
				if (notice) ctx.ui.notify(notice, "info");
			} catch {
				// A broken cache or renderer must not interrupt the session.
			}
			if (!shouldRefresh(cached, now(), { env })) return;
			pending = new AbortController();
			void refresh(pending.signal);
		});

		ports.on("session_shutdown", () => {
			pending?.abort();
			pending = undefined;
		});
	};
}
