import { vi } from "vitest";

// The Obsidian runtime is unavailable in a Node test environment, so the
// Obsidian API used by `src/main.ts` is mocked. Add any other Obsidian API
// members the plugin under test imports.
vi.mock("obsidian", () => ({
	App: class App { },

	Component: class Component {
		addChild() {}
		registerDomEvent() {}
		registerInterval() {}
		register() {}
		load() {}
		unload() {}
		onload() {}
		onunload() {}
	},
}));
