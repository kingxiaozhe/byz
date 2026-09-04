import assert from "node:assert/strict";
import test from "node:test";
import { renderProgressCard } from "../src/conversation/conversation-presenter.js";

test("truly paused compact status does not claim a pre-hook tool is running", () => {
	const rendered = renderProgressCard(
		{ language: "en" },
		{ totalMs: 8_000, waiting: true, waitingReason: "pause" },
		undefined,
		{ inFlightCount: 1, selectedStage: "command" },
		undefined,
		{ compact: true },
	);
	assert.match(rendered, /^Paused · 0m 08s · Tokens —$/);
	assert.doesNotMatch(rendered, /tool/);
});
