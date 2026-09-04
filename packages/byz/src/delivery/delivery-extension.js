import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeliveryActionRunner } from "./action-runner.js";
import { createGitSnapshot } from "./git-snapshot.js";
import { createDeliveryIntentStore } from "./intent.js";
import { projectDeliveryReadiness } from "./readiness.js";
import { createDeliveryScopeTracker } from "./scope.js";

const ACTIONS = new Set(["commit", "push", "pr", "merge"]);
const MAX_PENDING_MUTATIONS = 128;
const USAGE = "Usage: /deliver [status|commit|push|pr|merge|release]";

function confirmed(value) {
	return /^(confirm|yes|ok|确认|继续)$/i.test(String(value ?? "").trim());
}

function summary(snapshot, readiness) {
	return `Delivery: scope=${readiness.scope}; verification=${readiness.verification}; commit=${readiness.commit}; push=${readiness.push}; pr=${readiness.pr}; merge=${readiness.merge}; candidates=${snapshot.candidatePaths.length}; excluded=${snapshot.excludedCount}.`;
}

function previewTarget(target) {
	return Object.entries(target)
		.map(([key, value]) => `  ${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
		.join("\n");
}

export function createDeliveryExtension(options = {}) {
	const configuredRunner = options.runner;
	const makeTempDirectory = options.makeTempDirectory ?? mkdtemp;
	const removeDirectory = options.removeDirectory ?? rm;
	const intents = options.intents ?? createDeliveryIntentStore(options.intentOptions);
	const trackers = new Map();
	const registry = options.executionRegistry;

	return function deliveryExtension(ports) {
		const runner = configuredRunner ?? Object.freeze({ run: ports.exec });
		const pendingMutations = new Map();
		let actionActive = false;
		let cleanupBlocked = false;
		let scopeUnavailable = false;
		function trackerFor(context, reset = false) {
			let tracker = reset ? undefined : trackers.get(context.cwd);
			if (!tracker) {
				tracker = createDeliveryScopeTracker({
					cwd: context.cwd,
					appendReceipt: (receipt) => ports.appendScope(receipt),
					hasTask: (planId, taskId, generation) => registry?.hasTask?.(planId, taskId, generation) === true,
					readRegistrySnapshot: () => registry?.snapshot?.(),
				});
				tracker.replay(context.readDeliveryScopeEntries());
				trackers.set(context.cwd, tracker);
			}
			return tracker;
		}

		async function snapshotFor(context, pr) {
			if (!context.isProjectTrusted()) throw new Error("Delivery is available only in a trusted project.");
			const registrySnapshot = registry?.snapshot?.();
			const gitSnapshot = await createGitSnapshot({
				cwd: context.cwd,
				registrySnapshot,
				pr,
				runner,
				scopeTracker: trackerFor(context),
			});
			return {
				...gitSnapshot,
				readiness: projectDeliveryReadiness({
					baseBranch: options.baseBranch ?? "main",
					gitSnapshot,
					pr,
					registrySnapshot,
					trusted: true,
				}),
				registrySnapshot,
			};
		}

		ports.on("session_start", (_event, context) => {
			pendingMutations.clear();
			scopeUnavailable = false;
			trackerFor(context, true);
		});
		ports.on("tool_execution_start", (event, context) => {
			if (
				!context.isProjectTrusted() ||
				!["edit", "write"].includes(event.toolName) ||
				!event.path ||
				typeof event.toolCallId !== "string"
			) {
				return;
			}
			const registrySnapshot = registry?.snapshot?.();
			if (registrySnapshot?.availability !== "available" || !registrySnapshot.plan?.active?.id) return;
			if (
				scopeUnavailable ||
				pendingMutations.has(event.toolCallId) ||
				pendingMutations.size >= MAX_PENDING_MUTATIONS
			) {
				pendingMutations.clear();
				scopeUnavailable = true;
				return;
			}
			pendingMutations.set(
				event.toolCallId,
				Object.freeze({
					path: event.path,
					registrySnapshot,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
				}),
			);
		});
		ports.on("tool_execution_end", async (event, context) => {
			const observed = pendingMutations.get(event.toolCallId);
			pendingMutations.delete(event.toolCallId);
			if (
				scopeUnavailable ||
				event.outcome !== "success" ||
				!observed ||
				event.toolName !== observed.toolName ||
				event.path !== observed.path ||
				!context.isProjectTrusted()
			)
				return;
			try {
				await trackerFor(context).observe({ ...observed, outcome: "success" });
			} catch {
				// Scope observation is fail-closed and never widens delivery candidates.
			}
		});

		ports.registerCommand("deliver", {
			description: "Inspect and explicitly perform scoped delivery actions",
			handler: async (args, context) => {
				const action =
					String(args ?? "")
						.trim()
						.toLowerCase() || "status";
				if (action !== "status" && action !== "release" && !ACTIONS.has(action)) {
					context.ui.notify(USAGE, "warning");
					return;
				}
				if (!context.isProjectTrusted()) {
					context.ui.notify("Delivery is unavailable for an untrusted project.", "warning");
					return;
				}
				if (ACTIONS.has(action) && !context.isIdle()) {
					context.ui.notify("Delivery mutations are unavailable while the agent is running.", "warning");
					return;
				}
				const mutation = ACTIONS.has(action);
				if (mutation && cleanupBlocked) {
					context.ui.notify("Delivery is blocked because temporary-resource cleanup failed.", "warning");
					return;
				}
				if (mutation && actionActive) {
					context.ui.notify("Another delivery action is already active.", "warning");
					return;
				}
				if (mutation) actionActive = true;
				try {
					let pr;
					if (action === "pr" && !(await options.checkGitHub?.({ cwd: context.cwd, runner }))) {
						context.ui.notify(
							"Delivery pr is blocked because authenticated GitHub CLI is unavailable.",
							"warning",
						);
						return;
					}
					if (action === "merge") pr = await options.readPr?.({ cwd: context.cwd, runner });
					let before;
					try {
						before = await snapshotFor(context, pr);
					} catch (error) {
						context.ui.notify(
							error instanceof Error ? error.message : "Delivery snapshot is unavailable.",
							"warning",
						);
						return;
					}
					if (action === "status") {
						context.ui.notify(summary(before, before.readiness), "info");
						return;
					}
					if (action === "release") {
						context.ui.notify(
							`Release readiness: verification=${before.readiness.verification}; changelog=unknown; formal-tests=unknown; build=unknown; external-smoke=unknown; version-tag=manual; approval=manual. No release action is available.`,
							"info",
						);
						return;
					}
					if (before.readiness[action] !== "ready") {
						context.ui.notify(`Delivery ${action} is blocked by the current verified snapshot.`, "warning");
						return;
					}

					const target =
						action === "commit"
							? { message: options.commitMessage ?? "Update scoped BYZ work", paths: before.candidatePaths }
							: action === "push"
								? { branch: before.branch, commit: before.head, remote: "origin", upstream: before.upstream }
								: action === "pr"
									? {
											base: options.baseBranch ?? "main",
											head: before.branch,
											repository: before.origin.repository,
											title: options.prTitle ?? "Scoped BYZ delivery",
										}
									: { base: pr?.base, method: "squash", prNumber: pr?.number, repository: pr?.repository };
					const intent = intents.create(action, before, target);
					const answer = await context.input(
						`Action: ${action}\nTarget:\n${previewTarget(target)}\nImpact: changes Git or GitHub state.\nReject: no action is performed.\nType confirm to continue.`,
						"BYZ Delivery confirmation",
					);
					if (!confirmed(answer)) {
						intents.cancel();
						try {
							ports.appendResult({
								action,
								generation: before.registrySnapshot?.generation,
								outcome: "cancelled",
								preFingerprint: before.fingerprint,
								sideEffects: [],
							});
						} catch {}
						context.ui.notify(`Delivery ${action} cancelled; no action was performed.`, "info");
						return;
					}
					if (action === "pr" && !(await options.checkGitHub?.({ cwd: context.cwd, runner }))) {
						intents.cancel();
						try {
							ports.appendResult({
								action,
								generation: before.registrySnapshot?.generation,
								outcome: "stale",
								preFingerprint: before.fingerprint,
								sideEffects: [],
							});
						} catch {}
						context.ui.notify("Delivery state changed; GitHub CLI must be confirmed again.", "warning");
						return;
					}
					let currentPr;
					let current;
					try {
						currentPr = action === "merge" ? await options.readPr?.({ cwd: context.cwd, runner }) : undefined;
						current = await snapshotFor(context, currentPr);
					} catch {
						intents.cancel();
						context.ui.notify("Delivery state changed; preview and confirmation are required again.", "warning");
						return;
					}
					const consumed = intents.consume(intent.intentId, action, current);
					if (!consumed) {
						try {
							ports.appendResult({
								action,
								generation: current.registrySnapshot?.generation,
								outcome: "stale",
								postFingerprint: current.fingerprint,
								preFingerprint: before.fingerprint,
								sideEffects: [],
							});
						} catch {}
						context.ui.notify("Delivery state changed; preview and confirmation are required again.", "warning");
						return;
					}

					const actions = createDeliveryActionRunner({
						cwd: context.cwd,
						revalidateCommit: async () => {
							const candidates = (await trackerFor(context).candidates())
								.filter((entry) => entry.current)
								.map((entry) => [entry.path, entry.digest])
								.sort();
							return JSON.stringify(candidates) === JSON.stringify(current.candidateDigests);
						},
						revalidate: async () => {
							const latestPr =
								action === "merge" ? await options.readPr?.({ cwd: context.cwd, runner }) : undefined;
							const latest = await snapshotFor(context, latestPr);
							return latest.fingerprint === current.fingerprint;
						},
						runner,
					});
					let result;
					let bodyDirectory;
					let cleanupFailed = false;
					try {
						if (action === "commit") result = await actions.commit(consumed, current, options.commitMessage);
						else if (action === "push") result = await actions.push(consumed, current);
						else if (action === "pr") {
							bodyDirectory = await makeTempDirectory(join(tmpdir(), "byz-delivery-pr-"));
							await chmod(bodyDirectory, 0o700);
							const bodyFile = join(bodyDirectory, "body.md");
							await writeFile(bodyFile, "Scoped BYZ delivery.\n", { mode: 0o600 });
							result = await actions.createPr(consumed, current, {
								base: options.baseBranch ?? "main",
								bodyFile,
								title: options.prTitle,
							});
						} else result = await actions.merge(consumed, current, currentPr);
					} catch {
						result = { action, outcome: "failed", sideEffects: [] };
					} finally {
						if (bodyDirectory) {
							try {
								await removeDirectory(bodyDirectory, { force: true, recursive: true });
							} catch {
								cleanupFailed = true;
							}
						}
					}
					if (cleanupFailed) {
						cleanupBlocked = true;
						result = {
							...result,
							outcome: result.outcome === "success" ? "partial" : result.outcome,
							sideEffects: [...result.sideEffects, "cleanup_failed"],
						};
					}
					let postFingerprint;
					try {
						postFingerprint = (
							await snapshotFor(
								context,
								action === "merge" ? await options.readPr?.({ cwd: context.cwd, runner }) : undefined,
							)
						).fingerprint;
					} catch {}
					const receipt = {
						...result,
						generation: current.registrySnapshot?.generation,
						postFingerprint,
						preFingerprint: current.fingerprint,
					};
					try {
						ports.appendResult(receipt);
					} catch {
						context.ui.notify("Delivery action completed, but its audit receipt could not be saved.", "warning");
					}
					context.ui.notify(
						`Delivery ${action}: ${result.outcome}; side effects: ${result.sideEffects.join(", ") || "none"}. This is a workflow gate, not an OS permission sandbox.`,
						result.outcome === "success" ? "info" : "warning",
					);
				} finally {
					if (mutation) actionActive = false;
				}
			},
		});
	};
}

export { USAGE as DELIVERY_USAGE };
