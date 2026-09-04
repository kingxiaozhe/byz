import { parsePorcelainZ, sanitizeOrigin } from "./git-snapshot.js";

function success(result) {
	return result && result.exitCode === 0 && result.timedOut !== true;
}

function safeMessage(value, fallback) {
	return typeof value === "string" && value.length > 0 && value.length <= 120 && !/[\r\n\u0000]/.test(value)
		? value
		: fallback;
}

export function createDeliveryActionRunner(options) {
	async function run(program, args) {
		return options.runner.run(program, args, { cwd: options.cwd, timeoutMs: 30_000 });
	}
	async function assertFresh(action) {
		if (options.revalidate && !(await options.revalidate(action))) {
			throw new Error("Delivery state changed before the side effect.");
		}
	}
	async function commitBoundaryMatches(snapshot) {
		if (!Array.isArray(snapshot.status)) return options.revalidateCommit ? options.revalidateCommit() : true;
		try {
			const [head, branch, status, upstream, origin, remote] = await Promise.all([
				run("git", ["rev-parse", "HEAD"]),
				run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"]),
				run("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
				run("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]),
				run("git", ["remote", "get-url", "origin"]),
				run("git", ["ls-remote", "--heads", "origin", `refs/heads/${snapshot.branch}`]),
			]);
			if (!success(head) || head.stdout.trim() !== snapshot.head) return false;
			if (!success(branch) || branch.stdout.trim() !== snapshot.branch) return false;
			const currentUpstream = success(upstream) ? upstream.stdout.trim() : undefined;
			if (currentUpstream !== snapshot.upstream) return false;
			const currentOrigin = success(origin) ? sanitizeOrigin(origin.stdout.trim()) : undefined;
			if (JSON.stringify(currentOrigin) !== JSON.stringify(snapshot.origin)) return false;
			const remoteOid = success(remote) ? remote.stdout.trim().split(/\s+/)[0] || undefined : undefined;
			if (remoteOid !== snapshot.remoteBranchOid) return false;
			const candidateSet = new Set(snapshot.candidatePaths);
			const currentStatus = parsePorcelainZ(status.stdout);
			if (
				!success(status) ||
				currentStatus.some(
					(entry) =>
						candidateSet.has(entry.path) &&
						(entry.indexState === " " || entry.worktreeState !== " " || entry.conflict),
				)
			)
				return false;
			const closed = (entry) => [entry.path, entry.indexState, entry.worktreeState, entry.sourcePath];
			const beforeExcluded = snapshot.status
				.filter((entry) => !candidateSet.has(entry.path))
				.map(closed)
				.sort();
			const currentExcluded = currentStatus
				.filter((entry) => !candidateSet.has(entry.path))
				.map(closed)
				.sort();
			if (JSON.stringify(beforeExcluded) !== JSON.stringify(currentExcluded)) return false;
			return options.revalidateCommit ? options.revalidateCommit() : true;
		} catch {
			return false;
		}
	}

	return Object.freeze({
		async commit(intent, snapshot, message) {
			if (intent.action !== "commit" || snapshot.candidatePaths.length === 0)
				throw new Error("Commit is not ready.");
			const commitMessage = safeMessage(message, "Update scoped BYZ work");
			await assertFresh("commit");
			const blobOids = new Map();
			for (const path of snapshot.candidatePaths) {
				const blob = await run("git", ["hash-object", "--", path]);
				if (!success(blob) || !/^[0-9a-f]{40}$/.test(blob.stdout.trim()))
					throw new Error("Candidate blob is unavailable.");
				blobOids.set(path, blob.stdout.trim());
			}
			const add = await run("git", ["add", "--", ...snapshot.candidatePaths]);
			if (!success(add))
				return Object.freeze({ action: "commit", outcome: "failed", sideEffects: ["index_attempted"] });
			const staged = await run("git", ["diff", "--cached", "--name-only", "-z"]);
			const stagedPaths = staged.stdout.split("\0").filter(Boolean).sort();
			if (!success(staged) || JSON.stringify(stagedPaths) !== JSON.stringify([...snapshot.candidatePaths].sort())) {
				return Object.freeze({ action: "commit", outcome: "failed", sideEffects: ["index_changed"] });
			}
			for (const path of snapshot.candidatePaths) {
				const stagedBlob = await run("git", ["rev-parse", `:${path}`]);
				if (!success(stagedBlob) || stagedBlob.stdout.trim() !== blobOids.get(path)) {
					return Object.freeze({ action: "commit", outcome: "failed", sideEffects: ["index_changed"] });
				}
			}
			if (!(await commitBoundaryMatches(snapshot))) {
				return Object.freeze({ action: "commit", outcome: "failed", sideEffects: ["index_changed"] });
			}
			const commit = await run("git", ["commit", "--only", "-m", commitMessage, "--", ...snapshot.candidatePaths]);
			if (!success(commit))
				return Object.freeze({ action: "commit", outcome: "failed", sideEffects: ["index_changed"] });
			const head = await run("git", ["rev-parse", "HEAD"]);
			const commitSha = success(head) && /^[0-9a-f]{40}\n?$/.test(head.stdout) ? head.stdout.trim() : undefined;
			const parent = commitSha ? await run("git", ["rev-parse", `${commitSha}^`]) : undefined;
			const changed = commitSha
				? await run("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", commitSha])
				: undefined;
			const changedPaths = changed?.stdout.split("\0").filter(Boolean).sort() ?? [];
			let blobsExact = commitSha !== undefined;
			if (commitSha) {
				for (const path of snapshot.candidatePaths) {
					const committedBlob = await run("git", ["rev-parse", `${commitSha}:${path}`]);
					if (!success(committedBlob) || committedBlob.stdout.trim() !== blobOids.get(path)) blobsExact = false;
				}
			}
			const exact =
				commitSha !== undefined &&
				blobsExact &&
				success(parent) &&
				parent.stdout.trim() === snapshot.head &&
				success(changed) &&
				JSON.stringify(changedPaths) === JSON.stringify([...snapshot.candidatePaths].sort());
			return Object.freeze({
				action: "commit",
				outcome: exact ? "success" : "partial",
				commitSha,
				sideEffects: ["commit"],
			});
		},
		async push(intent, snapshot) {
			if (intent.action !== "push" || snapshot.upstream !== `origin/${snapshot.branch}`) {
				throw new Error("Push is not ready for origin/current branch.");
			}
			await assertFresh("push");
			const pushed = await run("git", ["push", "origin", `${snapshot.branch}:${snapshot.branch}`]);
			const observed = await run("git", ["ls-remote", "--heads", "origin", `refs/heads/${snapshot.branch}`]);
			const oid = success(observed) ? observed.stdout.trim().split(/\s+/)[0] : undefined;
			return Object.freeze({
				action: "push",
				outcome: success(pushed) && oid === snapshot.head ? "success" : oid ? "partial" : "failed",
				remoteOid: /^[0-9a-f]{40}$/.test(oid ?? "") ? oid : undefined,
				sideEffects: oid ? ["remote_branch_observed"] : ["push_attempted"],
			});
		},
		async createPr(intent, snapshot, input) {
			if (intent.action !== "pr" || snapshot.origin?.host !== "github") throw new Error("PR is not ready.");
			await assertFresh("pr");
			const created = await run("gh", [
				"pr",
				"create",
				"--repo",
				snapshot.origin.repository,
				"--draft",
				"--base",
				input.base,
				"--head",
				snapshot.branch,
				"--title",
				safeMessage(input.title, "Scoped BYZ delivery"),
				"--body-file",
				input.bodyFile,
			]);
			const observed = await run("gh", [
				"pr",
				"view",
				"--repo",
				snapshot.origin.repository,
				"--json",
				"number,url,headRefOid,baseRefName,isDraft",
			]);
			if (!success(observed)) {
				return Object.freeze({
					action: "pr",
					outcome: success(created) ? "partial" : "failed",
					sideEffects: ["pr_create_attempted"],
				});
			}
			try {
				const pr = JSON.parse(observed.stdout);
				const createdUrl = created.stdout.trim();
				const verified =
					success(created) &&
					Number.isSafeInteger(pr.number) &&
					createdUrl === `https://github.com/${snapshot.origin.repository}/pull/${pr.number}` &&
					pr.number > 0 &&
					pr.isDraft === true &&
					pr.headRefOid === snapshot.head &&
					pr.baseRefName === input.base;
				return Object.freeze({
					action: "pr",
					outcome: verified ? "success" : "partial",
					prNumber: Number.isSafeInteger(pr.number) ? pr.number : undefined,
					sideEffects: ["draft_pr_observed"],
				});
			} catch {
				return Object.freeze({ action: "pr", outcome: "partial", sideEffects: ["pr_create_attempted"] });
			}
		},
		async merge(intent, snapshot, pr) {
			if (
				intent.action !== "merge" ||
				pr.checks !== "success" ||
				pr.mergeable !== true ||
				pr.headSha !== snapshot.head ||
				pr.repository !== snapshot.origin?.repository
			) {
				throw new Error("PR merge is not ready.");
			}
			await assertFresh("merge");
			const merged = await run("gh", [
				"pr",
				"merge",
				String(pr.number),
				"--repo",
				snapshot.origin.repository,
				"--squash",
			]);
			const observed = await run("gh", [
				"pr",
				"view",
				String(pr.number),
				"--repo",
				snapshot.origin.repository,
				"--json",
				"state,mergedAt",
			]);
			if (!success(observed)) {
				return Object.freeze({
					action: "merge",
					outcome: success(merged) ? "partial" : "failed",
					sideEffects: ["merge_attempted"],
				});
			}
			try {
				const state = JSON.parse(observed.stdout);
				return Object.freeze({
					action: "merge",
					outcome: success(merged) && state.state === "MERGED" ? "success" : "partial",
					prNumber: pr.number,
					sideEffects: [state.state === "MERGED" ? "pr_merged" : "merge_attempted"],
				});
			} catch {
				return Object.freeze({ action: "merge", outcome: "partial", sideEffects: ["merge_attempted"] });
			}
		},
	});
}
