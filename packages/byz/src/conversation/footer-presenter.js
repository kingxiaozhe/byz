import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function formatTokens(count) {
	if (count < 1000) return String(count);
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function truncateText(text, width) {
	if (width <= 0) return "";
	if (text.length <= width) return text;
	if (width <= 1) return "…".slice(0, width);
	return `${text.slice(0, width - 1)}…`;
}

function findProjectRoot(cwd) {
	let dir = cwd;
	while (dir) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return cwd;
		dir = parent;
	}
	return cwd;
}

function getProjectName(cwd) {
	return basename(findProjectRoot(cwd)) || basename(cwd) || cwd;
}

function addUsage(totals, usage) {
	if (!usage) return;
	totals.input += usage.input ?? 0;
	totals.output += usage.output ?? 0;
	totals.cacheRead += usage.cacheRead ?? 0;
	totals.cacheWrite += usage.cacheWrite ?? 0;
	totals.cost += usage.cost?.total ?? 0;
}

function getUsageTotals(ctx) {
	const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	for (const entry of ctx.sessionManager?.getEntries?.() ?? []) {
		if (entry.type === "message" && entry.message?.role === "assistant") {
			addUsage(totals, entry.message.usage);
		} else if (entry.type === "message" && entry.message?.role === "toolResult") {
			addUsage(totals, entry.message.usage);
		} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
			addUsage(totals, entry.usage);
		}
	}
	return totals;
}

function shortModelName(modelId) {
	if (!modelId) return "no-model";
	return modelId
		.replace(/^claude-/, "")
		.replace(/^gpt-/, "gpt-")
		.replace(/-20\d{6}$/, "")
		.replace(/-latest$/, "");
}

function normalizeThinkingLevel(level) {
	return THINKING_LEVELS.has(level) ? level : "off";
}

export function createByzFooter(ctx, tui, theme, footerData, getThinkingLevel) {
	const unsubscribe = footerData.onBranchChange?.(() => tui.requestRender?.());
	return {
		invalidate() {
			tui.requestRender?.();
		},
		dispose() {
			unsubscribe?.();
		},
		render(width) {
			const safeWidth = Math.max(1, width ?? 80);
			const cwd = ctx.sessionManager?.getCwd?.() ?? ctx.cwd ?? process.cwd();
			const parts = [getProjectName(cwd)];
			const branch = footerData.getGitBranch?.();
			if (branch) parts.push(branch);

			const contextUsage = ctx.getContextUsage?.();
			if (contextUsage) {
				const left = contextUsage.percent === null ? "?" : `${Math.max(0, 100 - contextUsage.percent).toFixed(0)}%`;
				parts.push(`left ${left}`);
			}

			const usage = getUsageTotals(ctx);
			if (usage.input > 0) parts.push(`↑${formatTokens(usage.input)}`);
			if (usage.output > 0) parts.push(`↓${formatTokens(usage.output)}`);
			if (usage.cacheRead > 0) parts.push(`R${formatTokens(usage.cacheRead)}`);
			if (usage.cacheWrite > 0) parts.push(`W${formatTokens(usage.cacheWrite)}`);
			if (usage.cost > 0) parts.push(`$${usage.cost.toFixed(3)}`);

			const extensionStatuses = footerData.getExtensionStatuses?.();
			for (const text of extensionStatuses?.values?.() ?? []) {
				const clean = String(text)
					.replace(/[\r\n\t]/g, " ")
					.replace(/ +/g, " ")
					.trim();
				if (clean) parts.push(clean);
			}

			const leftText = parts.join("  ");
			const modelText = shortModelName(ctx.model?.id);
			const thinkingText = `thinking ${normalizeThinkingLevel(getThinkingLevel())}`;
			const rightText = `${modelText}  ${thinkingText}`;
			const minGap = 2;
			let line;
			if (leftText.length + minGap + rightText.length <= safeWidth) {
				line = `${leftText}${" ".repeat(safeWidth - leftText.length - rightText.length)}${rightText}`;
			} else if (rightText.length + minGap < safeWidth) {
				const leftBudget = Math.max(1, safeWidth - minGap - rightText.length);
				line = `${truncateText(leftText, leftBudget)}${" ".repeat(minGap)}${rightText}`;
			} else {
				line = truncateText(rightText, safeWidth);
			}
			return [theme.fg?.("dim", line) ?? line];
		},
	};
}
