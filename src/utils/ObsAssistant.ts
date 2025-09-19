import { FileView, ItemView, MarkdownView, TextFileView, TFile, View } from "obsidian";

export type ObsViewMode = "reader" | "preview" | "source";

export class ObsAssistant {

	public static viewMode(view: View): ObsViewMode {
		return ObsAssistant.isInReadingView(view) ? "reader" : (ObsAssistant.isInSourceMode(view) ? "source" : "preview");
	}

	/** See also {@link View#getViewType()}. */
	public static viewClassTypeAsSting(view: View) {
		if (view instanceof MarkdownView)
			return "MarkdownView";
		if (view instanceof TextFileView)
			return "TextFileView";
		if (view instanceof FileView)
			return "FileView";
		if (view instanceof ItemView)
			return "ItemView";

		return "View";
	}

	public static isInReadingView(view: View) {
		return view.getState()?.mode === "preview";
	}

	public static isInLivePreview(view: View) {
		const state = view.getState();
		return state ? state.mode === "source" && state.source === false : false;
	}

	public static isInSourceMode(view: View) {
		const state = view.getState();
		return state ? state.mode === "source" && state.source === true : false;
	}

	public static getFileFromView(view?: View | null | undefined): TFile | null {
		if (view === null || view === undefined)
			return null;
		if (view instanceof MarkdownView)
			return view.file;
		if (view instanceof FileView) // (MarkdownView), TextFileView, EditableFileView, FileView
			return view.file;
		return null;
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
