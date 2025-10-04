import { ViewUpdate } from "@codemirror/view";
import { Env } from "Env";
import { App, ItemView, MarkdownPostProcessorContext, MarkdownView, TFile, View } from "obsidian";
import { Logger } from "processing/Logger";
import { ObsAssistant, ObsViewMode } from "utils/ObsAssistant";
import { isDescendantOrEqual } from "utils/dom";
import { Arr } from "utils/ts";

export class ProcessingContext {

	public readonly vuCtx: ViewUpdateContext | null;
	public readonly ppCtx: PostProcessorContext | null;
	public readonly logr: Logger;

	/**
		* `<div class="workspace-leaf-content" data-type="{view type}">`
		*
		* - Will be `null` if processing outside of a {@link View}.
		* - If {@link view} is not `null`, then this value will use {@link View.containerEl} (instead of searching for it in the DOM).
		* - Might not be `null` even if {@link view} is `null`.
		*/
	public readonly viewContainerEl: HTMLElement | null;

	/**
		* `null` if an instance of a relevant {@link View} could not be found.
		*/
	public readonly view: View | null;
	public readonly markdownView: MarkdownView | null;
	public readonly viewingMode: ObsViewMode;

	public readonly associatedFile: TFile | null;

	public readonly isCacheAccessReadOnly: boolean;

	constructor(log: Logger, view: View | null, mode: ObsViewMode, viewContainerEl: HTMLElement | null, associatedFile: TFile | null, underlyingCtx: ViewUpdateContext | PostProcessorContext) {
		this.logr = log;

		this.view = view;
		this.markdownView = view instanceof MarkdownView ? view : null;

		this.viewingMode = mode;
		this.associatedFile = associatedFile;

		this.vuCtx = underlyingCtx instanceof ViewUpdateContext ? underlyingCtx : null;
		this.ppCtx = underlyingCtx instanceof PostProcessorContext ? underlyingCtx : null;
		Env.dev.assert(this.vuCtx || this.ppCtx);

		this.viewContainerEl = viewContainerEl;

		this.isCacheAccessReadOnly = !this.isCacheAccessReadWrite();
	}

	public static fromViewUpdate(app: App, logger: Logger, viewUpdate: ViewUpdate): ProcessingContext {

		// <div class="workspace-leaf-content" data-type="markdown" data-mode="source">     <-- viewContainerEl / View.containerEl
		//   <div class="view-content">                        <-- ItemView.contentEl
		//     <div class"markdown-source-view">
		//       <div class="cm-editor cm-focused ͼ1 ͼ2 ">     <-- ViewUpdateContext.editorEl / EditorView.dom
		//	       <div class="cm-scroller">
		// 		       <div class="cm-sizer">
		// 			       <div class="cm-contentContainer">
		// 				       <div class="cm-content">              <-- ViewUpdateContext.contentEl / EditorView.contentDOM
		//                 <div dir="ltr" class="cm-line">     <-- document content starts here
		//                 <img src="blob:…" contenteditable="false" data-come-down-original-source="https://…" data-come-down-state="4">


		const contentEl = viewUpdate.view.contentDOM;
		let viewContainerEl: HTMLElement | null = null;

		let view = ProcessingContext.tryGetViewInstance(app, contentEl);
		if (view)
			viewContainerEl = view.containerEl;

		// No view, get the container by traversing up.
		if (viewContainerEl === null)
			viewContainerEl = Arr.firstOrNull(ObsAssistant.viewContainerEl({ element: contentEl, dir: "up" }));

		let viewingMode = ProcessingContext.tryGetViewingMode(view ?? undefined, viewContainerEl ?? undefined);

		let associatedFile: TFile | null = null;
		if (view !== null)
			associatedFile = ObsAssistant.getFileFromView(view);

		return new ProcessingContext(logger, view, viewingMode, viewContainerEl, associatedFile, new ViewUpdateContext(viewUpdate, view));
	}

	public static fromPostProcessor(app: App, logger: Logger, element: HTMLElement, postProcessorContext: MarkdownPostProcessorContext): ProcessingContext & { readonly ppCtx: PostProcessorContext } {

		// <div class="workspace-leaf-content" data-type="markdown" data-mode="preview">     <-- `containerEl`
		//   <div class="view-content">                        <--
		//     <div class"markdown-reading-view">
		//       <div class="markdown-preview-view markdown-renderered">     <--
		//	       <div class="markdown-preview-sizer markdown-preview-section">
		// 		       <div class="markdown-preview-pusher">
		// 			     <div class="mod-header mod-ui">
		// 				   <div class="el-pre mod-frontmatter mod-ui">
		//           <div class="el-h1">     <-- document content starts here
		//           <div class="el-p">
		//             <div>
		//               <img src="blob:…" contenteditable="false" data-come-down-original-source="https://…" data-come-down-state="4">

		let viewContainerEl: HTMLElement | null = null;

		let view = ProcessingContext.tryGetViewInstance(app, element);
		if (view)
			viewContainerEl = view.containerEl;

		// No view, get the container.
		if (viewContainerEl === null)
			viewContainerEl = Arr.firstOrNull(ObsAssistant.viewContainerEl({ element: element, postProcessorContext: postProcessorContext, dir: "up" }));

		let viewingMode = ProcessingContext.tryGetViewingMode(view ?? undefined, viewContainerEl ?? undefined);
		// If there's a MarkdownPostProcessorContext the markdown has already been processed so must be read only…
		if (viewingMode === "none")
			viewingMode = "reader";

		// When processing markdown, there should be a source file from which the markdown came from.
		// If `MarkdownRenderer.render` lead to this processing pass `context.sourcePath` is what was passed to that method. Perhaps invalid paths are not validated.
		let associatedFile: TFile | null = app.vault.getFileByPath(postProcessorContext.sourcePath);

		// Fallback
		// For example, if a call to `MarkdownRenderer.render`, which takes a `sourcePath`, caused this post processing, then `MarkdownPostProcessorContext.sourcePath` is set to whatever the caller passed to `render`. Perhaps there's no check for the existance of an actual file for that path.
		if (associatedFile === null && view !== null)
			associatedFile = ObsAssistant.getFileFromView(view);

		const ctx = new ProcessingContext(logger, view, viewingMode, viewContainerEl, associatedFile, new PostProcessorContext(element, postProcessorContext));
		return ctx as ProcessingContext & { readonly ppCtx: PostProcessorContext };
	}

	public static logInit(ctx: ProcessingContext) {
		if (!Env.isDev)
			return ctx;

		const l = ctx.logr;

		if (ctx.view !== null) {
			l.log(l.msg("\t", "Found `View` instance of class:", ObsAssistant.viewClassTypeAsSting(ctx.view) + " / " + ctx.view.getViewType()));
		}
		else {
			if (ctx.viewContainerEl)
				l.log(l.msg("\t", "Did not find `View` instance, but found view container element:", ctx.viewContainerEl.classList.value));
			else {
				l.log(l.msg("\t", "Did not find `View` instance nor a view container element"));

				const ctxEl = ctx.ppCtx?.mdCtx ? ObsAssistant.containerElFromPostProcessorContext(ctx.ppCtx.mdCtx) : null;
				if (ctxEl)
					l.log(l.msg("\t", "Found a container element in the post processing context", ctxEl.classList.value));
			}
		}

		l.log(l.msg("\t", "Primary element", (ctx.ppCtx ? ctx.ppCtx.element : ctx.vuCtx!.contentEl).classList.value));
		l.log(l.msg("\t", "View mode:", ctx.viewingMode, ", File:", ctx.associatedFile?.basename ?? "No associated file"));

		if (ctx.vuCtx && ctx.viewingMode === "preview") {
			const u = ctx.vuCtx.viewUpdates();
			const changed = Object.keys(u).filter(key => u[key]);
			const notChanged = Object.keys(u).filter(key => !u[key]);

			ctx.logr.log("\t", `${changed.length} view updates:`);
			if (changed.length > 0)
				ctx.logr.log("\t", `🟢 ${changed.join(", ")}`);
			if (changed.length > 0 && notChanged.length > 0)
				ctx.logr.log("\t", `🔴 ${notChanged.join(", ")}`);
		}

		return ctx;
	}

	public assertViewUpdateContext(): asserts this is this & { readonly vuCtx: ViewUpdateContext } {
		if (!this.vuCtx)
			throw new Error("Not in edit update context.");
	}

	public assertPostProcessor(): asserts this is this & { readonly ppCtx: PostProcessorContext } {
		if (!this.ppCtx)
			throw new Error("Not in markdown post processing context.");
	}

	/** @returns `true` if if the requestor/retainer path is available. */
	public isCacheAccessReadWrite(): this is this & { readonly associatedFile: TFile } {
		// Determine whether it is read write here.
		return this.associatedFile !== null;
	}

	public get isInPostProcessingPass() {
		return this.ppCtx !== null;
	}

	/**
		* @remarks The workspace's active view, if any, is not necessarily the where to current processing occurs.
		*
		* @param element The view container (or a child element) which content is currently being processed.
		* @returns The active {@link View} instance if its `containerEl` is equal to {@link element}
		*/
	private static tryGetViewInstance(app: App, element: HTMLElement) {
		const activeView = ObsAssistant.getActiveView(app);
		return activeView !== null && isDescendantOrEqual(activeView.containerEl, element) ? activeView : null;
	}

	/** Will try by using {@link view} first; if fails, will try {@link viewContainerEl}. */
	private static tryGetViewingMode(view?: View, viewContainerEl?: HTMLElement) {
		let viewMode: ObsViewMode = "none";

		if (view)
			viewMode = ObsAssistant.viewMode(view);

		if (viewMode === "none" && viewContainerEl)
			viewMode = ObsAssistant.viewModeFromContainerEl(viewContainerEl);

		return viewMode;
	}

	public getPreferredContainerElFromViewUpdate(): HTMLElement {
		const el = this.getPreferredContainerEl();
		if (el === null)
			throw new Error("Expected non-null container element");
		return el;
	}

	public getPreferredContainerEl() {
		Env.log.d(this.logr.t(() => this.logr.msg(`ProcessingContext:getPreferredContainerEl: is post processor: ${this.isInPostProcessingPass}; viewingMode ${this.viewingMode}; has viewContanerEl: ${this.viewContainerEl ? true : false}`)));

		if (this.vuCtx)
			return this.vuCtx.contentEl;

		this.assertPostProcessor();
		const pp = this.ppCtx;
		const viewOrUndefined = this.view ?? undefined;
		let el: HTMLElement | null = null;

		// Check if reading view container is available first, this is the primary reading view container used in, e.g., tabs.
		// A popover, for example, do not have a reading view.

		if (pp.isElementAttached()) {
			el = Arr.firstOrNull(ObsAssistant.readingViewEl({ element: pp.element, dir: "up" }));
			el = el ?? Arr.firstOrNull(ObsAssistant.viewContentEl({ element: pp.element, dir: "up" }));
			el = el ?? Arr.firstOrNull(ObsAssistant.popoverEl({ element: pp.element, dir: "up" }));
			el = el ?? Arr.firstOrNull(ObsAssistant.previewViewEl({ element: pp.element, dir: "up", allDescendants: false }));
		}
		else {
			if (this.viewContainerEl)
				el = Arr.firstOrNull(ObsAssistant.readingViewEl({ element: this.viewContainerEl, dir: "down" }));

			if (el === null) {
				if (this.view instanceof ItemView)
					el = this.view.contentEl;
				else if (this.viewContainerEl)
					el = Arr.firstOrNull(ObsAssistant.viewContentEl({ element: this.viewContainerEl, dir: "down" }));
			}

			// Ex: Hover over a note in file explorer to display a popover preview where images are outside of the viewport so their HTML chunks are not connected to the document.
			if (el === null)
				el = Arr.firstOrNull(ObsAssistant.popoverEl({ view: viewOrUndefined, postProcessorContext: pp.mdCtx, dir: "updown" }));
		}

		// Do the utmost to find a preview view
		if (el === null) {
			el = Arr.firstOrNull(ObsAssistant.previewViewEl({
				dir: "updown",
				element: pp.element,
				view: viewOrUndefined,
				postProcessorContext: pp.mdCtx,
				allDescendants: false,
			}));
		}

		if (Env.isDev && el !== null && this.viewingMode === "reader") {
			const sourceView = Arr.firstOrNull(ObsAssistant.sourceViewEl({ element: el, dir: "down" }));
			if (sourceView)
				Env.log.w("ProcessingContext:preferredEl:", "Reader has access to source view.");
		}

		return el;
	}

	public domEquals(other: ProcessingContext): boolean {
		Env.assert(this.vuCtx !== null && other.vuCtx !== null || this.ppCtx !== null && other.ppCtx !== null);
		let eq = true;

		if (this.vuCtx !== null && other.vuCtx !== null)
			eq = this.vuCtx.equalsDom(other.vuCtx);
		else if (this.ppCtx !== null && other.ppCtx !== null)
			eq = this.ppCtx.equalsDom(other.ppCtx);
		else
			Env.assert();

		if (eq)
			eq = this.viewContainerEl === other.viewContainerEl;

		return eq;
	}
}

class ViewUpdateContext {

	public readonly viewUpdate: ViewUpdate;
	public readonly view: View | null;

	/** <div class="cm-editor"> */
	public readonly editorEl: HTMLElement;

	/** `<div class="cm-content">` */
	public readonly contentEl: HTMLElement;

	//public readonly state: EditUpdateState;

	constructor(viewUpdate: ViewUpdate, view: View | null) {
		this.viewUpdate = viewUpdate;
		this.view = view;

		this.editorEl = viewUpdate.view.dom;
		this.contentEl = viewUpdate.view.contentDOM;

		//this.state = EditUpdateState.get(viewUpdate);
	}

	public equalsDom(other: ViewUpdateContext): boolean {
		return this.editorEl === other.editorEl && this.contentEl === other.contentEl;
	}

	/**
		* Never seems to become more specific / go deeper than the {@link contentEl}.
		* Will be equal to {@link contentEl} when cursor is below the frontmatter.
		*/
	public get activeEl(): Element | null {
		return this.viewUpdate.view.root.activeElement;
	}

	public get isContentElActive() {
		return isDescendantOrEqual(this.contentEl, this.activeEl);
	}

	public get hasUpdates() {
		const vu = this.viewUpdate;
		return vu.docChanged || vu.viewportChanged || vu.selectionSet || vu.focusChanged || vu.geometryChanged || vu.heightChanged || vu.viewportMoved;
	}

	public viewUpdates(): Record<string, boolean> {
		return {
			docChanged: this.viewUpdate.docChanged,
			viewportChanged: this.viewUpdate.viewportChanged,
			selectionSet: this.viewUpdate.selectionSet,
			focusChanged: this.viewUpdate.focusChanged,
			geometryChanged: this.viewUpdate.geometryChanged,
			heightChanged: this.viewUpdate.heightChanged,
			viewportMoved: this.viewUpdate.viewportMoved,
		};
	}
}

class PostProcessorContext {
	public readonly mdCtx: MarkdownPostProcessorContext;

	/** The HTML part that is currently being processed. Likely not attached to the DOM. */
	public readonly element: HTMLElement;

	constructor(element: HTMLElement, markdownPostProcessorContext: MarkdownPostProcessorContext) {
		this.element = element;
		this.mdCtx = markdownPostProcessorContext;
	}

	public equals(other: PostProcessorContext): boolean {
		if (this === other) return true;

		if (!this.equalsDom(other)) return false;
		if (this.mdCtx.sourcePath !== other.mdCtx.sourcePath) return false;
		if (this.mdCtx.docId !== other.mdCtx.docId) return false;

		return true;
	}

	public equalsDom(other: PostProcessorContext): boolean {
		return this.element === other.element;
	}

	/**
		* @param parent Specify to check whether {@link element} is attached to this specific parent. If `null` method returns false.
		* @returns `true` if {@link element} is "connected (directly or indirectly) to a `Document` object".
		*/
	public isElementAttached(parent?: HTMLElement | null) {
		if (parent === null || !this.element.isConnected)
			return false;
		return parent === undefined || isDescendantOrEqual(parent, this.element);
	}
}
