import { Box, Markdown, type MarkdownTheme, Spacer, Text } from "@earendil-works/pi-tui";
import type { CompactionSummaryMessage } from "../../../core/messages.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { keyText } from "./keybinding-hints.ts";

/**
 * Component that renders a compaction message with collapsed/expanded state.
 * Uses same background color as custom messages for visual consistency.
 */
export class CompactionSummaryMessageComponent extends Box {
	private expanded = false;
	private message: CompactionSummaryMessage;
	private markdownTheme: MarkdownTheme;

	constructor(message: CompactionSummaryMessage, markdownTheme: MarkdownTheme = getMarkdownTheme()) {
		super(1, 1, (t) => theme.bg("customMessageBg", t));
		this.message = message;
		this.markdownTheme = markdownTheme;
		this.updateDisplay();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	private updateDisplay(): void {
		this.clear();

		const tokenStr = this.message.tokensBefore.toLocaleString();
		const label = theme.fg("customMessageLabel", `\x1b[1m上下文已整理 / Context organized\x1b[22m`);
		this.addChild(new Text(label, 0, 0));
		this.addChild(new Spacer(1));

		if (this.expanded) {
			const header = `**已整理较长的历史内容 / Long context organized**\n\n原始上下文约 ${tokenStr} tokens。下面是保留下来的关键结论，方便继续完成你的目标。\nThe previous context was long, so this keeps the key points needed to continue.\n\n`;
			this.addChild(
				new Markdown(header + this.message.summary, 0, 0, this.markdownTheme, {
					color: (text: string) => theme.fg("customMessageText", text),
				}),
			);
		} else {
			this.addChild(
				new Text(
					theme.fg(
						"customMessageText",
						"对话太长，已整理关键内容继续处理 / Long context organized to keep going. （",
					) +
						theme.fg("dim", keyText("app.tools.expand")) +
						theme.fg("customMessageText", " 查看摘要 / view summary）"),
					0,
					0,
				),
			);
		}
	}
}
