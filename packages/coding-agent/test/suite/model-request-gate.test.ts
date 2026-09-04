import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { assistantMsg, userMsg } from "../utilities.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("model request gate", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("awaits the payload-free gate before normal and automatic retry requests", async () => {
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let calls = 0;
		const harness = await createHarness({
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
			extensionFactories: [
				(pi) => {
					pi.on("model_request_gate", async (event) => {
						expect(event).toEqual({ type: "model_request_gate" });
						calls += 1;
						if (calls === 1) await gate;
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
			fauxAssistantMessage("recovered"),
		]);
		const prompt = harness.session.prompt("test");
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(calls).toBe(1);
		expect(harness.getPendingResponseCount()).toBe(2);
		release();
		await prompt;
		expect(calls).toBe(2);
	});

	it("uses the same gate for manual compaction summarization", async () => {
		let calls = 0;
		const harness = await createHarness({
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: [
				(pi) => {
					pi.on("model_request_gate", () => {
						calls += 1;
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage("one"),
			fauxAssistantMessage("two"),
			fauxAssistantMessage("turn prefix summary"),
			fauxAssistantMessage("summary"),
		]);
		await harness.session.prompt("first");
		await harness.session.prompt("second");
		expect(calls).toBe(2);
		await harness.session.compact();
		expect(calls).toBe(4);
	});

	it("uses the same gate for automatic compaction", async () => {
		let calls = 0;
		const harness = await createHarness({
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: [
				(pi) => {
					pi.on("model_request_gate", () => {
						calls += 1;
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage("one"),
			fauxAssistantMessage("two"),
			fauxAssistantMessage("turn prefix summary"),
			fauxAssistantMessage("summary"),
		]);
		await harness.session.prompt("first");
		await harness.session.prompt("second");
		const session = harness.session as unknown as {
			_runAutoCompaction(reason: "threshold", willRetry: boolean): Promise<boolean>;
		};
		await session._runAutoCompaction("threshold", false);
		expect(calls).toBe(4);
	});

	it("uses the same gate for branch summarization", async () => {
		let calls = 0;
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("model_request_gate", () => {
						calls += 1;
					});
				},
			],
		});
		harnesses.push(harness);
		const targetId = harness.sessionManager.appendMessage(userMsg("first branch"));
		harness.sessionManager.appendMessage(assistantMsg("first reply"));
		harness.sessionManager.appendMessage(userMsg("abandoned work"));
		harness.sessionManager.appendMessage(assistantMsg("abandoned reply"));
		harness.setResponses([fauxAssistantMessage("branch summary")]);
		const result = await harness.session.navigateTree(targetId, { summarize: true });
		expect(result.cancelled).toBe(false);
		expect(calls).toBe(1);
	});

	it("gates each branch summarization retry", async () => {
		let calls = 0;
		const harness = await createHarness({
			settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
			extensionFactories: [
				(pi) => {
					pi.on("model_request_gate", () => {
						calls += 1;
					});
				},
			],
		});
		harnesses.push(harness);
		const targetId = harness.sessionManager.appendMessage(userMsg("first branch"));
		harness.sessionManager.appendMessage(assistantMsg("first reply"));
		harness.sessionManager.appendMessage(userMsg("abandoned work"));
		harness.sessionManager.appendMessage(assistantMsg("abandoned reply"));
		harness.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
			fauxAssistantMessage("branch summary"),
		]);
		const result = await harness.session.navigateTree(targetId, { summarize: true });
		expect(result.cancelled).toBe(false);
		expect(calls).toBe(2);
	});

	it("preserves no-handler request and compaction compatibility", async () => {
		const harness = await createHarness({ settings: { compaction: { keepRecentTokens: 1 } } });
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage("one"),
			fauxAssistantMessage("two"),
			fauxAssistantMessage("turn prefix summary"),
			fauxAssistantMessage("summary"),
		]);
		await harness.session.prompt("first");
		await harness.session.prompt("second");
		await expect(harness.session.compact()).resolves.toBeDefined();
	});

	it("fails before provider execution when the gate cancels", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("model_request_gate", () => {
						throw new Error("model request cancelled");
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("must not run")]);
		await harness.session.prompt("test");
		expect(JSON.stringify(harness.session.messages)).not.toContain("must not run");
		expect(harness.eventsOfType("agent_end")).toHaveLength(1);
	});
});
