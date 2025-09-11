import { ItemView } from "obsidian";

export type ObsViewMode = "reader" | "preview" | "source";

export class ObsAssistant {

	public static viewMode(view: ItemView): ObsViewMode {
		return ObsAssistant.isInReadingView(view) ? "reader" : (ObsAssistant.isInSourceMode(view) ? "source" : "preview");
	}

	public static isInReadingView(view: ItemView) {
		return view.getState()?.mode === "preview";
	}

	public static isInLivePreview(view: ItemView) {
		const state = view.getState();
		return state ? state.mode === "source" && state.source === false : false;
	}

	public static isInSourceMode(view: ItemView) {
		const state = view.getState();
		return state ? state.mode === "source" && state.source === true : false;
	}

	public static readerContainerEl(someAncestorEl: HTMLElement): HTMLDivElement | null {
		// <div class="workspace-leaf-content" data-type="markdown" data-mode="preview">
		// 	<div class="view-content">
		// 		<div class="markdown-reading-view" style="width: 100%; height: 100%;">

		return someAncestorEl.querySelector(Selector.READING_VIEW);
	}
}

const Selector = {
	READING_VIEW: ".markdown-reading-view",
} as const;
