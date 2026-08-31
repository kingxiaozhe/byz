import { describe, expect, it } from "vitest";
import {
	DEFAULT_INTERACTIVE_PRODUCT_PROFILE,
	resolveInteractiveProductProfile,
} from "../src/modes/interactive/interactive-mode.ts";

describe("interactive product profile", () => {
	it("keeps Pi startup presentation enabled by default", () => {
		expect(resolveInteractiveProductProfile()).toEqual(DEFAULT_INTERACTIVE_PRODUCT_PROFILE);
		expect(resolveInteractiveProductProfile()).toEqual({
			showStartupHeader: true,
			showLoadedResources: true,
		});
	});

	it("lets a wrapper independently disable built-in startup surfaces", () => {
		expect(
			resolveInteractiveProductProfile({
				showStartupHeader: false,
				showLoadedResources: false,
			}),
		).toEqual({
			showStartupHeader: false,
			showLoadedResources: false,
		});
		expect(resolveInteractiveProductProfile({ showStartupHeader: false })).toEqual({
			showStartupHeader: false,
			showLoadedResources: true,
		});
	});
});
