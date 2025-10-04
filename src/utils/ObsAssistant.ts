import { Env } from "Env";
import { App, FileView, getIcon, ItemView, MarkdownPostProcessorContext, MarkdownView, TextFileView, TFile, View } from "obsidian";
import { childEl, firstChildEl, firstParentEl } from "utils/dom";
import { Arr } from "utils/ts";

export type ObsViewMode = "none" | "reader" | "preview" | "source";

export type TryGetFirstOptions = {
	dir: "down" | "up" | "downup" | "updown";
	element?: HTMLElement;
	postProcessorContext?: MarkdownPostProcessorContext;
	view?: View;
};

export type TryGetAllOptions = Prettify<TryGetFirstOptions & {
	allDescendants: boolean;
}>;

export class ObsAssistant {

	/** Internal API */
	public static containerElFromPostProcessorContext(postProcessorContext: MarkdownPostProcessorContext) {
		Env.assert("containerEl" in postProcessorContext, "MarkdownPostProcessorContext does not have `containerEl`");
		// @ts-ignore
		const containerEl = postProcessorContext.containerEl;
		if (containerEl)
			return containerEl as HTMLElement;
		else
			return null;
	}

	/** @returns The first container element found that is the root of a {@link View}. */
	public static viewContainerEl(options: TryGetFirstOptions) {
		return ObsAssistant.tryGetEl(Selector.WORKSPACE_LEAF_CONTENT, options);
	}

	/** `<div class="view-content">` */
	public static viewContentEl(options: TryGetFirstOptions) {
		return ObsAssistant.tryGetEl(Selector.VIEW_CONTENT, options);
	}

	/** The main reading view container. Sibling to {@link sourceViewEl}. */
	public static readingViewEl(options: TryGetFirstOptions) {
		return ObsAssistant.tryGetEl(Selector.READING_VIEW, options);
	}

	public static sourceViewEl(options: TryGetFirstOptions) {
		return ObsAssistant.tryGetEl(Selector.SOURCE_VIEW, options);
	}

	/**
		* This is the base class for all popover windows.
		*
		* @example
		*
		* ```html
		* <div class="popover hover-popover">`
		* 	<div class="markdown-embed is-loaded">
    * 		<div class="markdown-embed-content …">
    *				<div class="markdown-preview-view markdown-rendered …">
    *				</div>
    *				…
    *			</div>
    *		</div>
    *	</div>
		* ```
		*
		* @remarks `hover-popover` is a modifier class that extends or specifies the behavior. It indicates the popover appears on hover.
		*/
	public static popoverEl(options: TryGetFirstOptions) {
		return ObsAssistant.tryGetEl(Selector.POPOVER, options);
	}

	/**
		* The container that styles HTML rendered markdown (e.g, with `MarkdownRenderer`) the
		* standard way it looks in Obsidian's reader view.
		*
		* `<div class="markdown-preview-view">`
		*
		* Additional classes, such as `markdown-rendered` (content has been processed) or `is-readable-line-width` (when the user has enabled the "Readable line length" setting) might also appear.
		*
		* @remarks Do not assume that there's only one of these elements in the DOM. Plugins, like the Kanban plugin for example, might render different content in different small boxes. Each box then contains one of these preview view containers containing the rendered markdown.
		*/
	public static previewViewEl(options: TryGetAllOptions) {
		return ObsAssistant.tryGetEl(Selector.PREVIEW_VIEW, options);
	}

	private static tryGetEl(selectors: string, options: TryGetFirstOptions | TryGetAllOptions): HTMLElement[] {
		let element: HTMLElement[] | null = null;

		const findChildOrChildren = (options as TryGetAllOptions).allDescendants === true ? childEl : firstChildEl;

		const find = (el: HTMLElement) => {
			if (options.dir === "down") {
				element = Arr.orNull(findChildOrChildren(el, selectors));
			}
			else if (options.dir === "up") {
				element = Arr.orNull(firstParentEl(el, selectors));
			}
			else if (options.dir === "downup") {
				element = Arr.orNull(findChildOrChildren(el, selectors));
				if (element === null)
					element = Arr.orNull(firstParentEl(el, selectors));
			}
			else if (options.dir === "updown") {
				element = Arr.orNull(firstParentEl(el, selectors));
				if (element === null)
					element = Arr.orNull(findChildOrChildren(el, selectors));
			}
		};

		if (options.view !== undefined) {
			if (options.view instanceof ItemView)
				find(options.view.contentEl);
			else
				find(options.view.containerEl);
		}

		if (element === null && options.postProcessorContext) {
			const postProcessorContainerEl = ObsAssistant.containerElFromPostProcessorContext(options.postProcessorContext);
			if (postProcessorContainerEl)
				find(postProcessorContainerEl);
		}

		if (element === null && options.element) {
			find(options.element);
		}

		return element ?? [];
	}

	public static viewMode(view: View): ObsViewMode {
		let vm: ObsViewMode = "none";

		const state = view.getState();
		const mode = state["mode"];

		if (Env.str.is(mode)) {
			if (mode === "preview")
				vm = "reader"
			else if (mode === "source")
				vm = Env.bool.isTrue(state["source"]) ? "source" : "preview";
		}

		return vm;
	}

	public static viewModeFromContainerEl(viewContainerEl: HTMLElement): ObsViewMode {
		let vm: ObsViewMode = "none";

		const dataMode = ObsAssistant.getAttributeFromContainerEl(viewContainerEl, Attributes.WorkspaceLeaf.DATA_MODE);
		if (dataMode) {
			if (dataMode === "preview")
				vm = "reader";
			else if (dataMode === "source") {
				const sourceViewEl = firstChildEl(viewContainerEl, Selector.SOURCE_VIEW);
				if (sourceViewEl !== null)
					vm = sourceViewEl.classList.contains("is-live-preview") ? "preview" : "source";
			}
		}

		return vm;
	}

	public static viewTypeFromContainerEl(viewContainerEl: HTMLElement) {
		const type = ObsAssistant.getAttributeFromContainerEl(viewContainerEl, Attributes.WorkspaceLeaf.DATA_TYPE);
		// file-explorer, markdown, …
		return type;
	}

	private static getAttributeFromContainerEl(viewContainerEl: HTMLElement, attribute: string) {
		if (Env.isDev)
			Env.dev.assert(viewContainerEl.classList.contains(ClassName.WORKSPACE_LEAF_CONTENT), "Expected element to have class", ClassName.WORKSPACE_LEAF_CONTENT);
		return viewContainerEl.getAttribute(attribute);
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
		if (view instanceof View)
			return "View";
		Env.dev.assert(false, "Expected View");
		return "NA";
	}

	/** @returns If {@link view} extends {@link FileView}, returns the {@link TFile}. */
	public static getFileFromView(view?: View | null | undefined): TFile | null {
		if (view === null || view === undefined)
			return null;
		// if (view instanceof MarkdownView)
		// 	return view.file;
		if (view instanceof FileView) // MarkdownView, TextFileView, EditableFileView, FileView
			return view.file;
		return null;
	}

	/**
		* Gets the view of the specified type that is currently marked as the workspace’s
		* active view. This is usually the view inside the leaf that receives commands
		* and hotkeys.
		*
		* @returns The active {@link View} instance, or `null` if no matching view is the workspace’s active view.
		*/
	public static getActiveView(app: App): View | null {
		return app.workspace.getActiveViewOfType(View);
	}

	public static getIcon(iconID: string, options?: { el?: HTMLElement, color?: string, fallbackColor?: string, fallbackIconID?: string }): SVGSVGElement | null {
		const {
			el = document.body,
			color,
			fallbackColor = "#919191",
			fallbackIconID,
		} = options || {};

		let icon = getIcon(iconID);

		Env.assert(icon !== null, "Icon ID not found:", iconID);
		if (icon === null && fallbackIconID !== undefined)
			icon = getIcon(fallbackIconID);
		if (icon === null)
			return null;

		const iconColor = color ?? getComputedStyle(el).getPropertyValue(CssVar.Icon.COLOR).trim();
		Env.assert(iconColor, "CSS variable not found:", CssVar.Icon.COLOR);
		icon.setAttribute("stroke", iconColor || fallbackColor);
		icon.setAttribute("stroke-width", "1");

		return icon;
	}
}

const ClassName = {
	READING_VIEW: "markdown-reading-view",
	SOURCE_VIEW: "markdown-source-view",
	/** The root element of the {@link View}; the {@link View#containerEl}. */
	WORKSPACE_LEAF_CONTENT: "workspace-leaf-content",
	VIEW_CONTENT: "view-content",
	PREVIEW_VIEW: "markdown-preview-view",
	POPOVER: "popover",
} as const;

const Selector = {
	READING_VIEW: "." + ClassName.READING_VIEW,
	/** Either live preview or source code. */
	SOURCE_VIEW: "." + ClassName.SOURCE_VIEW,
	PREVIEW_VIEW: "." + ClassName.PREVIEW_VIEW,
	POPOVER: "." + ClassName.POPOVER,
	WORKSPACE_LEAF_CONTENT: "." + ClassName.WORKSPACE_LEAF_CONTENT,
	VIEW_CONTENT: "." + ClassName.VIEW_CONTENT,
} as const;

const CssVar = {
	/** https://docs.obsidian.md/Reference/CSS+variables/Foundations/Icons */
	Icon: {
		COLOR: "--icon-color"
	} as const,
} as const;

const Attributes = {
	WorkspaceLeaf: {
		DATA_TYPE: "data-type",
		DATA_MODE: "data-mode",
	}
}
