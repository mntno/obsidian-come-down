import { EditorView, ViewUpdate } from "@codemirror/view";
import { App, MarkdownPostProcessorContext, MarkdownView, TFile } from "obsidian";
import { CacheManager, CacheRequest } from "./CacheManager";
import { Env, LoggerFn } from "./Env";
import { HtmlAssistant, HTMLElementAttribute, HTMLElementCacheState } from "./HtmlAssistant";
import { CodeMirrorAssistant } from "./utils/CodeMirrorAssistant";
import { ObsAssistant, ObsViewMode } from "./utils/ObsAssistant";
import { Url } from "./utils/Url";
import { Workarounds } from "./Workarounds";

export class ProcessingPass {

	private readonly markdownView: MarkdownView;
	public readonly associatedFile: TFile;
	public readonly log: LoggerFn;

	/** `true` when invoked by the Markdown post processor. */
	public readonly isInPostProcessingPass: boolean;
	public readonly mode: ObsViewMode;
	private readonly viewUpdate?: ViewUpdate;

	public readonly passID: number;
	private static updatePassID: number = 0;
	private static postProcessorPassID: number = 0;

	private constructor(id: number, isInPostProcessingPass: boolean, markdownView: MarkdownView, file: TFile, log: LoggerFn, viewUpdate?: ViewUpdate) {
		this.passID = id;
		this.isInPostProcessingPass = isInPostProcessingPass;
		this.markdownView = markdownView;
		this.associatedFile = file;
		this.mode = ObsAssistant.viewMode(markdownView);
		this.viewUpdate = viewUpdate;
		this.log = log;
	}

	public static beginFromViewUpdate(app: App, viewUpdate: ViewUpdate, options?: {
		/** Return `null` is view is in source mode. Defaults to `true`. */
		abortInSourceMode: boolean;
		noFile?: (id: number, log: LoggerFn) => void;
	}): ProcessingPass | null {

		const thisID = this.updatePassID++;
		const log = Env.log.edit;
		const {
			abortInSourceMode = true,
		} = options || {};

		const markdownView = app.workspace.getActiveViewOfType(MarkdownView);
		if (markdownView === null || markdownView.file === null) {
			ProcessingPass.handleNoAssociatedFile(viewUpdate, thisID, log);
			options?.noFile?.(thisID, log);
			log(ProcessingPass.abortLogMsg(true, thisID));
			return null;
		}

		const instance = new this(thisID, false, markdownView, markdownView.file, log, viewUpdate);

		if (abortInSourceMode && instance.mode === "source") {
			log(ProcessingPass.abortLogMsg(true, thisID));
			return null;
		}

		instance.log(instance.logMsg(`Start edit update pass in ${instance.mode} mode. ➡️🚪`));

		if (Env.isDev && instance.mode === "preview") {
			const u: Record<string, boolean> = {
				docChanged: viewUpdate.docChanged,
				viewportChanged: viewUpdate.viewportChanged,
				selectionSet: viewUpdate.selectionSet,
				focusChanged: viewUpdate.focusChanged,
				geometryChanged: viewUpdate.geometryChanged,
				heightChanged: viewUpdate.heightChanged,
				viewportMoved: viewUpdate.viewportMoved,
			};
			const changed = Object.keys(u).filter(key => u[key]);
			const notChanged = Object.keys(u).filter(key => !u[key]);

			instance.log(`\t${changed.length} view updates:`);
			if (changed.length > 0)
				instance.log(`\t🟢 ${changed.join(", ")}`);
			if (changed.length > 0 && notChanged.length > 0)
				instance.log(`\t🔴 ${notChanged.join(", ")}`);
		}

		return instance;
	}

	public static beginFromPostProcessorContext(app: App, context: MarkdownPostProcessorContext): ProcessingPass | null {

		const thisID = this.postProcessorPassID++;
		const log = Env.log.read;
		log(Env.dev.icon.POST_PROCESS_PASS, "Start post processor pass ➡️🚪", ProcessingPass.idString(thisID));

		let associatedFile: TFile | null = null;
		const markdownView = app.workspace.getActiveViewOfType(MarkdownView);

		if (markdownView !== null)
			associatedFile = markdownView.file;
		if (associatedFile === null)
			associatedFile = app.vault.getFileByPath(context.sourcePath);

		if (markdownView !== null && associatedFile !== null) {
			return new this(thisID, true, markdownView, associatedFile, log);
		}
		else {
			log(ProcessingPass.abortLogMsg(false, thisID));
			return null;
		}
	}

	public end(cacheManager: CacheManager) {
		this.log(this.logMsg(this.isInUpdatePass ? "Finished update pass." : "Finished post processing pass."), "✅🚪➡️");

		const options = {
			preventReleases: this.isInPostProcessingPass,
			requestsToIgnore: this.requestsToIgnore,
		};

		cacheManager.updateRetainedCaches(Object.values(this.requestsToRetain), this.associatedFile.path, options).then(() => {
			this.log(this.logMsg("\tCalling saveMetadataIfDirty"));
			cacheManager.saveMetadataIfDirty();
		});
	}

	public enqueue(operation: () => Promise<void>): Promise<void> {
		ProcessingPass.serialQueue = ProcessingPass.serialQueue.then(() => operation());
		return ProcessingPass.serialQueue;
	}
	private static serialQueue: Promise<void> = Promise.resolve();

	public get idString() {
		return "ID " + this.passID;
	}

	public static idString(id: number) {
		return "ID " + id
	}

	public abortLogMsg() {
		return ProcessingPass.abortLogMsg(this.isInUpdatePass, this.passID);
	}

	public static abortLogMsg(isInUpdatePass: boolean, passID: number) {
		if (!Env.isDev)
			return Env.str.EMPTY;

		if (isInUpdatePass)
			return `${Env.dev.icon.EDIT_UPDATE_PASS} Aborting update pass ❌🚪➡️ ${ProcessingPass.idString(passID)}`;
		else
			return `${Env.dev.icon.POST_PROCESS_PASS} Aborting post processing pass ❌🚪➡️ ${ProcessingPass.idString(passID)}`;
	}

	public logMsg(...msg: string[]) {
		if (!Env.isDev)
			return Env.str.EMPTY;
		return `${this.isInUpdatePass ? Env.dev.icon.EDIT_UPDATE_PASS : Env.dev.icon.POST_PROCESS_PASS} ${msg.join(Env.str.SPACE)} ${this.idString}`;
	}

	public get isInUpdatePass() {
		return !this.isInPostProcessingPass;
	}

	/** @returns `<div class="view-content">` which is a descendant of {@link containerEl} and the parent of both the reader and source container elements. */
	public get contentEl() {
		return this.markdownView.contentEl;
	}

	/** @returns The element `<div class="workspace-leaf-content" data-type="markdown" data-mode="X">` where `X` is `preview` if in reader view or `source` otherwise. */
	public get containerEl() {
		return this.markdownView.containerEl;
	}

	public retainCache(urlOrCache: string | CacheRequest) {
		Env.assert(urlOrCache);
		Env.log.d(Env.dev.thunkedStr(() => this.logMsg(`retainCache: Will retain ${CacheManager.createCacheKeyFromOriginalSrc(Env.str.is(urlOrCache) ? urlOrCache : urlOrCache.source)} at the end of pass`)));

		if (Env.str.is(urlOrCache)) {
			Env.assert(urlOrCache.length > 0);
			this.requestsToRetain[urlOrCache] = CacheManager.createRequest(urlOrCache, this.associatedFile.path);
		}
		else {
			this.requestsToRetain[urlOrCache.source] = urlOrCache;
		}
	}
	private requestsToRetain: Record<string, CacheRequest> = {};

	public ignoreCache(src: string) {
		Env.assert(src);
		this.log(Env.dev.thunkedStr(() => this.logMsg(`ignoreCache: Will ignore ${CacheManager.createCacheKeyFromOriginalSrc(src)} at the end of pass`)));

		this.requestsToIgnore.add(CacheManager.createRequest(src, this.associatedFile.path));
	}
	private requestsToIgnore = new Set<CacheRequest>();

	public get currentNumberOfRequestsToRetain() {
		return Object.keys(this.requestsToRetain).length;
	}

	/** No file/note info is available yet but the contentDOM is so cancel image loading. */
	public static handleNoAssociatedFile(update: ViewUpdate, id: number, log: LoggerFn) {
		log(Env.dev.icon.EDIT_UPDATE_PASS, "No associated file in this update. Will cancel all `img` tags found in current DOM.", ProcessingPass.idString(id));

		const sourcesToIgnore = Workarounds.detectSourcesOfInvalidImageElements(update);

		// There is no file to work with. All that can be done is to cancel loading.
		const imageElements = HtmlAssistant.findAllImageElements(update.view.contentDOM, true, (imageElement) => {
			const src = imageElement.getAttribute(HTMLElementAttribute.SRC);

			// Filter out image elements without a src or invalid.
			if (src === null || !Workarounds.HandleInvalidImageElements(sourcesToIgnore, imageElement, src))
				return false;

			// Allow image elements with external urls through so they can be cancelled.
			return Logic.isValidExternalUrl(src);
		});

		HtmlAssistant.cancelImageLoading(imageElements);
	}

	/**
		* `currentDOM` only includes nodes visible in the viewport (plus a margin).
		* This method makes sure the remaining images in the note are retained to prevent them from being deleted.
		* @returns
		*/
	public handleImagesNotInCurrentDOM() {
		Env.assert(this.viewUpdate);
		if (!this.viewUpdate)
			return;

		const imagesOutsideViewport = CodeMirrorAssistant.findImagesOutsideViewport(this.viewUpdate.view, (url) => Logic.isValidExternalUrl(url));
		this.log(Env.dev.thunkedStr(() => this.logMsg("Found " + imagesOutsideViewport?.length + " images outside viewport:" + imagesOutsideViewport?.map(f => f.src).join(", "))));

		if (imagesOutsideViewport) {
			for (const image of imagesOutsideViewport)
				Logic.isValidExternalUrl(image.src, (src) => this.retainCache(image.src));
		}
	}

	public static findRelevantImagesToProcessInPostProcessor(element: HTMLElement, _context: MarkdownPostProcessorContext, requireSrcAttribute: boolean): [imageElementsToProcess: HTMLImageElement[], remainingElements: HTMLImageElement[]] {
		const imageElements = HtmlAssistant.findAllImageElements(element, requireSrcAttribute);
		const remainingElements: HTMLImageElement[] = [];
		const elementsToProcess: HTMLImageElement[] = [];

		const imagesToCancelFilter = (imageElement: HTMLImageElement) => {
			const src = HtmlAssistant.getSrc(imageElement);
			return Logic.filterIrrelevantCacheStates(imageElement) || Logic.isValidExternalUrl(src);
		};

		for (const imageElement of imageElements) {
			if (imagesToCancelFilter(imageElement))
				elementsToProcess.push(imageElement);
			else
				remainingElements.push(imageElement);
		}

		return [elementsToProcess, remainingElements];
	}

	public findRelevantImagesToProcessViewUpdate(update: ViewUpdate): [imageElementsToProcess: HTMLImageElement[], remainingElements: HTMLImageElement[]] {

		// Elements in DOM at this stage might be in states in which the `src` attribute has been removed. Therefore the `src` attribute is not required when finding image elements.
		const imageElements = HtmlAssistant.findAllImageElements(update.view.contentDOM, false);
		const sourcesToIgnore = Workarounds.detectSourcesOfInvalidImageElements(update);

		const remainingElements: HTMLImageElement[] = [];
		const imagesToCancel: HTMLImageElement[] = [];

		const imagesToCancelFilter = (imageElement: HTMLImageElement) => {
			const src = HtmlAssistant.getSrc(imageElement);

			// 2. If there's no src there's nothing left to do but to remove all states that have passed this stage already.
			if (src === null)
				return Logic.filterIrrelevantCacheStates(imageElement);

			// 3. Only external urls are relevant.
			if (!Logic.isValidExternalUrl(src))
				return false;

			// 4. Filter out invalid.
			if (!Workarounds.HandleInvalidImageElements(sourcesToIgnore, imageElement, src))
				return false;

			// 5. Remove all states that have passed this stage already.
			return Logic.filterIrrelevantCacheStates(imageElement);
		};

		for (const imageElement of imageElements) {

			// 1. First check if a new URL was set on an existing element so that it will be canceled.
			this.checkIfUrlChanged(update, imageElement);

			if (imagesToCancelFilter(imageElement))
				imagesToCancel.push(imageElement);
			else
				remainingElements.push(imageElement);
		}

		return [imagesToCancel, remainingElements];
	}

	/**
		* Detects whether the url of an already existing image elemetent was changed by the user, and if so, treats the image element as newly added.
		*
		* - Should be initial processing step in the editor listener (or at least before canceling starts).
		* - Note: This must be the first thing that happens since the state is reset, i.e., it effectively aborts any actions that would've been taken on other states.
		* - That said, the previous element might have been deleted by the system and a new element created, in which case this method does nothing.
		*
		* @param update
		* @param imageElement
		*/
	private checkIfUrlChanged(update: ViewUpdate, imageElement: HTMLImageElement) {
		Env.log.d(this.logMsg("ProcessingPass:resetIfNeeded"), update.docChanged, HtmlAssistant.cacheState(imageElement), HtmlAssistant.getSrc(imageElement), Logic.isValidExternalUrl(HtmlAssistant.getSrc(imageElement)));

		// These all come together to reveal that the src has changed and thus is treated as a new image.
		// - `update.docChanged`: user edited
		// - `HtmlAssistant.cacheState(imageElement) != HTMLElementCacheState.ORIGINAL`: Only unprocessed/"original" image elements have `src` set to external urls...
		// - `Logic.isValidExternalUr`: ...but this one *has* such url.
		// Therefore the src was modified, which is tantamount to a separate, added image element, so the state need to be reset and it will be treated as such.
		// The cache reference will be released as it is not retained now.

		if (update.docChanged && HtmlAssistant.cacheState(imageElement) != HTMLElementCacheState.ORIGINAL && Logic.isValidExternalUrl(HtmlAssistant.getSrc(imageElement))) {
			this.log(Env.dev.thunkedStr(() => this.logMsg(`Url changed on image from ${HtmlAssistant.originalSrc(imageElement)} to ${HtmlAssistant.getSrc(imageElement)}`)));
			HtmlAssistant.resetElement(imageElement); // Set state to "untouched".
		}
	}

	/** Makes sure that elements requesting cache, waiting for download, or already cached, are not released when {@link end} is called. */
	public handleRequestingAndSucceeded(imageElements: HTMLImageElement[]) {
		Env.log.d("ProcessingPass:handleActive:", imageElements);
		for (const imageElement of imageElements) {
			// As all images are retained in each pass, even though elements that are already cached are excluded from further processing, they still need to be retained.
			if (HtmlAssistant.cacheState(imageElement) == HTMLElementCacheState.CACHE_SUCCEEDED) {
				const src = HtmlAssistant.originalSrc(imageElement);
				Env.assert(src !== null, "Expected original source dataset");
				if (src)
					this.retainCache(src);
			}

			if (HtmlAssistant.isElementCacheStateEqual(imageElement, HTMLElementCacheState.REQUESTING, HTMLElementCacheState.REQUESTING_DOWNLOADING)) {
				const src = HtmlAssistant.originalSrc(imageElement);
				Env.assert(src !== null, "Expected original source dataset");
				if (src)
					this.ignoreCache(src);
			}
		}
	}

	public static sleep(milliseconds: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, milliseconds));
	}

	/**
		* Asynchronously waits for an element to be attached to the DOM.
		* @param element The element to check.
		* @param timeoutMs The maximum time to wait in milliseconds.
		* @returns A promise that resolves when the element has a parent, or rejects on timeout.
		*/
	public static waitForElementAttachment(element: HTMLElement, timeoutMs = 500, delay = 1): Promise<void> {
		return new Promise((resolve, reject) => {
			const startTime = Date.now();
			const check = () => {
				if (element.parentElement)
					resolve();
				else if (Date.now() - startTime > timeoutMs)
					reject(new Error(`Element was not attached to the DOM within ${timeoutMs}ms.`));
				else
					setTimeout(check, delay);
			};
			check();
		});
	}
}

class Logic {
	private readonly logger: ProcessingPass;

	constructor(logger: ProcessingPass) {
		this.logger = logger;
	}

	/**
		* @param src
		* @param success
		* @returns `true` if {@link src} is relevant and should be processed, in which case {@link success} will be invoked with the trimmed value.
		*/
	public static isValidExternalUrl(src: string | null | undefined, success?: (src: string) => void): boolean {
		// not `undefined`, `null`, or empty string.
		if (src) {
			src = src.trim();
			if (src.length > 0 && Url.isValid(src) && Url.isExternal(src)) {
				success?.(src);
				return true;
			}
		}

		return false;
	}

	/**
		* Remove requesting, downloading, done, and invalid.
		* - The done image element is already pointing to the cached resource. No need to do anything more.
		* - Those that are downloading will be handled as the download finishes as part of a previous pass.
		*
		* Keep
		* - Original: these need to be cancelled
		* - Cancelled and Failed: these need to request cache.
		*
		* @param imageElement
		* @returns `false` if state of {@link imageElement} is one of the above mentioned irrelevant states.
		*/
	public static filterIrrelevantCacheStates(imageElement: HTMLImageElement) {
		Env.log.d(Env.dev.icon.NONE, "ProcessingPass:filterIrrelevantCacheStates");
		const state = HtmlAssistant.cacheState(imageElement)

		// return HtmlAssistant.isCacheStateEqual(state, [
		// 	HTMLElementCacheState.ORIGINAL,
		// 	HTMLElementCacheState.ORIGINAL_SRC_REMOVED,
		// 	HTMLElementCacheState.CACHE_FAILED
		// ]);

		// Difference between this and the above is that ORIGINAL matches all unprocessed elements.
		return !HtmlAssistant.isCacheStateEqual(state,
			HTMLElementCacheState.REQUESTING,
			HTMLElementCacheState.REQUESTING_DOWNLOADING,
			HTMLElementCacheState.CACHE_SUCCEEDED,
			HTMLElementCacheState.INVALID
		);
	}
}
