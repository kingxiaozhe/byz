const REQUIRED_VERIFICATION_CATEGORIES = Object.freeze(["test", "check", "build", "review", "qa"]);

export function projectDeliveryReadiness(input) {
	const plan = input.registrySnapshot?.availability === "available" ? input.registrySnapshot.plan : undefined;
	const verifiedPassed = plan?.counts?.verifiedPassedEvidence ?? 0;
	const verifiedFailed = plan?.counts?.verifiedFailedEvidence ?? 0;
	const passedCategories = new Set(plan?.counts?.verifiedPassedCategories ?? []);
	const failedCategories = new Set(plan?.counts?.verifiedFailedCategories ?? []);
	const declared = plan?.counts?.declaredEvidence ?? 0;
	const observed = plan?.counts?.observedEvidence ?? 0;
	const planReady =
		plan?.state === "terminal" &&
		Number.isSafeInteger(plan.total) &&
		plan.total > 0 &&
		plan.counts?.completed === plan.total &&
		(plan.counts?.blocked ?? 0) === 0 &&
		(plan.counts?.cancelled ?? 0) === 0;
	const git = input.gitSnapshot;
	const scoped = (git?.candidatePaths?.length ?? 0) > 0;
	const cleanIndex = !(git?.status ?? []).some((entry) => entry.indexState !== " ");
	const verificationCategories = Object.freeze(
		Object.fromEntries(
			REQUIRED_VERIFICATION_CATEGORIES.map((category) => [
				category,
				failedCategories.has(category) ? "failed" : passedCategories.has(category) ? "verified" : "unknown",
			]),
		),
	);
	const verification =
		verifiedFailed > 0 || failedCategories.size > 0
			? "failed"
			: REQUIRED_VERIFICATION_CATEGORIES.every((category) => passedCategories.has(category))
				? "verified"
				: verifiedPassed > 0 || declared > 0 || observed > 0
					? "partial"
					: "unknown";
	const branchReady =
		input.trusted &&
		planReady &&
		verification === "verified" &&
		cleanIndex &&
		git?.conflictCount === 0 &&
		!git?.detached;
	const commitReady = branchReady && scoped && git?.origin?.host === "github";
	const cleanWorktree = (git?.status?.length ?? 0) === 0;
	const originReady = git?.origin?.host === "github" && git.upstream === `origin/${git.branch}`;
	return Object.freeze({
		scope:
			git?.conflictCount > 0
				? "conflicted"
				: scoped
					? git.excludedCount > 0
						? "dirty_excluded"
						: "ready"
					: "unavailable",
		verification,
		verificationCategories,
		commit: commitReady ? "ready" : "blocked",
		push: branchReady && cleanWorktree && originReady ? "ready" : "blocked",
		pr: branchReady && cleanWorktree && originReady && git.remoteBranchOid === git.head ? "ready" : "blocked",
		merge:
			branchReady &&
			cleanWorktree &&
			originReady &&
			input.pr?.checks === "success" &&
			input.pr?.mergeable === true &&
			input.pr?.repository === git.origin.repository &&
			input.pr?.headSha === git.head &&
			input.pr?.base === (input.baseBranch ?? "main") &&
			/^[0-9a-f]{40}$/.test(input.pr?.baseSha ?? "")
				? "ready"
				: "blocked",
		release: "informational",
	});
}
