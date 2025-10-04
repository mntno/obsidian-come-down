import { CacheManager, CacheRequest } from "cache/CacheManager";
import { Env } from "Env";
import { EditorViewPlugin, EditorViewPluginInfo } from "processing/EditorViewPlugin";
import { HtmlAssistant, HTMLElementCacheState } from "processing/HtmlAssistant";
import { Logger } from "processing/Logger";
import { ProcessingContext } from "processing/ProcessingContext";
import { Workarounds } from "processing/Workarounds";
import { CodeMirrorAssistant } from "utils/CodeMirrorAssistant";
import { ObsViewMode } from "utils/ObsAssistant";
import { Url } from "utils/Url";

type FetchedSrc = string | null;

export class ProcessingPass {

	public readonly ctx: ProcessingContext;

	public constructor(ctx: ProcessingContext) {
		Env.dev.assert(ctx.vuCtx !== null || ctx.ppCtx !== null);
		this.ctx = ctx;
	}

	public static createViewUpdateLogger() {
		return new Logger(Env.log.edit, this.updatePassID++, Env.dev.icon.EDIT_UPDATE_PASS);
	}
	private static updatePassID: number = 0;

	public static createPostProcessorLogger() {
		return new Logger(Env.log.read, this.postProcessorPassID++, Env.dev.icon.POST_PROCESS_PASS);
	}
	private static postProcessorPassID: number = 0;

	public end(cacheManager: CacheManager) {
		this.ctx.logr.log(this.ctx.logr.endMsg("ReadOnly:", !this.ctx.isCacheAccessReadWrite()));

		if (this.ctx.isCacheAccessReadWrite()) {
			const options = {
				preventReleases: this.ctx.isInPostProcessingPass,
				requestsToIgnore: this.requestsToIgnore,
				logger: this.ctx.logr,
			};

			cacheManager.updateRetainedCaches(Object.values(this.requestsToRetain), this.ctx.associatedFile.path, options).then(() => {
				this.ctx.logr.log(this.ctx.logr.msg("\tCalling saveMetadataIfDirty"));
				cacheManager.saveMetadataIfDirty();
			});
		}
	}

	public static nextPostProcessorPassID() {
		return this.postProcessorPassID++;
	}

	public retainCache(urlOrCache: string | CacheRequest) {
		if (this.ctx.isCacheAccessReadWrite()) {
			Env.assert(urlOrCache);
			this.ctx.logr.log(this.ctx.logr.t(() => this.ctx.logr.msg(`retainCache: Will retain ${CacheManager.createCacheKeyFromOriginalSrc(Env.str.is(urlOrCache) ? urlOrCache : urlOrCache.source)} at the end of pass`)));

			if (Env.str.is(urlOrCache)) {
				Env.assert(urlOrCache.length > 0);
				this.requestsToRetain[urlOrCache] = CacheManager.createRequest(urlOrCache, this.ctx.associatedFile.path);
			}
			else {
				this.requestsToRetain[urlOrCache.source] = urlOrCache;
			}
		}
	}
	private requestsToRetain: Record<string, CacheRequest> = {};

	public ignoreCache(src: string) {
		if (this.ctx.isCacheAccessReadWrite()) {
			Env.assert(src);
			this.ctx.logr.log(this.ctx.logr.t(() => this.ctx.logr.msg(`ignoreCache: Will ignore ${CacheManager.createCacheKeyFromOriginalSrc(src)} at the end of pass`)));

			this.requestsToIgnore.add(CacheManager.createRequest(src, this.ctx.associatedFile.path));
		}
	}
	private requestsToIgnore = new Set<CacheRequest>();

	/**
		* `currentDOM` only includes nodes visible in the viewport (plus a margin).
		* This method makes sure the remaining images in the note are retained to prevent them from being deleted.
		*
		* @param imageElementsInDom Images in viewport/DOM returned by {@link findRelevantImagesToProcessViewUpdate} that have **already been canceled**.
		* @returns
		*/
	public handleImagesNotInCurrentDOM(imageElementsInDom: HTMLImageElement[]) {
		Env.log.d("ProcessingPass:handleImagesNotInCurrentDOM");
		this.ctx.assertViewUpdateContext();

		const imgSrcInDom = imageElementsInDom.map(el => {
			Env.dev.assert(HtmlAssistant.cacheState(el) !== HTMLElementCacheState.ORIGINAL);
			return HtmlAssistant.originalSrc(el, false);
		});

		const imagesOutsideViewport = CodeMirrorAssistant.findAllImages(this.ctx.vuCtx.viewUpdate.view, (url) => {
			const normalizedUrl = Url.normalizeUrl(url);
			if (imgSrcInDom.includes(normalizedUrl))
				return false;
			return Url.isValidExternalUrl(normalizedUrl); // These urls might be local.
		});

		this.ctx.logr.log(this.ctx.logr.t(() => this.ctx.logr.msg("Found " + imagesOutsideViewport?.length + " images outside viewport: " + imagesOutsideViewport?.map(f => f.src).join(", "))));
		imagesOutsideViewport?.forEach(image => this.retainCache(image.src));
	}

	public static findRelevantImagesToProcessInPostProcessor(element: HTMLElement | null, requireSrcAttribute: boolean): { elementsToProcess: HTMLImageElement[], remainingElements: HTMLImageElement[] } {
		const remainingElements: HTMLImageElement[] = [];
		const elementsToProcess: HTMLImageElement[] = [];

		if (element !== null) {
			const imageElements = HtmlAssistant.findAllImageElements(element, requireSrcAttribute);
			const imagesToCancelFilter = (imageElement: HTMLImageElement, availableSrc?: FetchedSrc) => {

				const src = ProcessingPass.src(imageElement, availableSrc);

				// Edge case, e.g.: `<img>`
				if (src === null && HtmlAssistant.cacheState(imageElement) === HTMLElementCacheState.ORIGINAL)
					return false;

				return ProcessingPass.filterIrrelevantCacheStates(imageElement) || HtmlAssistant.isImageToProcess(imageElement);
			};

			for (const imageElement of imageElements) {
				const src = ProcessingPass.src(imageElement);
				if (imagesToCancelFilter(imageElement, src))
					elementsToProcess.push(imageElement);
				else if (src !== null)
					remainingElements.push(imageElement);
			}
		}

		return { elementsToProcess, remainingElements };
	}

	public static findRelevantImagesToProcessViewUpdate(ctx: ProcessingContext): { elementsToProcess: HTMLImageElement[], remainingElements: HTMLImageElement[] } {
		ctx.assertViewUpdateContext();

		// Elements in DOM at this stage might be in states in which the `src` attribute has been removed. Therefore the `src` attribute is not required when finding image elements.
		const imageElements = HtmlAssistant.findAllImageElements(ctx.getPreferredContainerElFromViewUpdate(), false);
		const sourcesToIgnore = Workarounds.detectSourcesOfInvalidImageElements(ctx.vuCtx.viewUpdate);

		const elementsToProcess: HTMLImageElement[] = [];
		const remainingElements: HTMLImageElement[] = [];

		const imagesToCancelFilter = (imageElement: HTMLImageElement, availableSrc?: FetchedSrc) => {
			// This filter should work regardless of whether the `src` attr. has been removed, or set to an icon, or is empty.
			// Make jugements based on state.
			const src = ProcessingPass.src(imageElement, availableSrc);

			// Edge case, e.g.: `<img>`
			if (src === null && HtmlAssistant.cacheState(imageElement) === HTMLElementCacheState.ORIGINAL)
				return false;

			// 2. If there's no src there's nothing left to do but to remove all states that have passed this stage already.
			if (src === null)
				return ProcessingPass.filterIrrelevantCacheStates(imageElement);

			// 3. Check if this image element should be ignored.
			if (!Workarounds.handleInvalidImageElements(sourcesToIgnore, imageElement, src))
				return false;

			// 3. Only external urls are relevant.
			// 		If not negating and returning false, local urls won't be cached here
			if (!HtmlAssistant.isImageToProcess(imageElement))
				return false;

			// 4. At this stage filtering based on urls should be done, and here, just look at states to remove all states that have passed this stage already.
			return ProcessingPass.filterIrrelevantCacheStates(imageElement);
		};

		for (const imageElement of imageElements) {

			const src = ProcessingPass.src(imageElement);

			// 1. First check if a new URL was set on an existing element so that it will be canceled.
			ProcessingPass.checkIfUrlChanged(ctx, imageElement, src);

			if (imagesToCancelFilter(imageElement, src))
				elementsToProcess.push(imageElement);
			else if (src !== null)
				remainingElements.push(imageElement);
		}

		return { elementsToProcess, remainingElements };
	}

	private static src = (imageElement: HTMLImageElement, availableSrc?: FetchedSrc) => availableSrc === undefined ? HtmlAssistant.getSrc(imageElement) : availableSrc;

	/**
		* Detects whether the url of an already existing image elemetent was changed by the user, and if so, treats the image element as newly added.
		*
		* - Should be initial processing step in the editor listener (or at least before canceling starts).
		* - Note: This must be the first thing that happens since the state is reset, i.e., it effectively aborts any actions that would've been taken on other states.
		* - That said, the previous element might have been deleted by the system and a new element created, in which case this method does nothing.
		*/
	private static checkIfUrlChanged(ctx: ProcessingContext, imageElement: HTMLImageElement, availableSrc?: FetchedSrc) {
		ctx.assertViewUpdateContext();

		const src = ProcessingPass.src(imageElement, availableSrc);
		const changed = ctx.vuCtx.viewUpdate.docChanged && HtmlAssistant.cacheState(imageElement) != HTMLElementCacheState.ORIGINAL && Url.isValidExternalUrl(src);

		Env.log.d(ctx.logr.msg("ProcessingPass:checkIfUrlChanged", changed));

		// These all come together to reveal that the src has changed and thus is treated as a new image.
		// - `update.docChanged`: user edited
		// - `HtmlAssistant.cacheState(imageElement) != HTMLElementCacheState.ORIGINAL`: Only unprocessed/"original" image elements have `src` set to external urls...
		// - `Logic.isValidExternalUr`: ...but this one *has* such url.
		// Therefore the src was modified, which is tantamount to a separate, added image element, so the state need to be reset and it will be treated as such.
		// The cache reference will be released as it is not retained now.

		if (changed) {
			ctx.logr.log(ctx.logr.t(() => ctx.logr.msg(`Url changed on image from ${HtmlAssistant.originalSrc(imageElement)} to ${src}`)));
			HtmlAssistant.resetElement(imageElement); // Set state to "untouched".
		}
	}

	/**
		* Remove elements with states: requesting, downloading, done, and invalid.
		*
		* - Those done are already pointing to the cached resource. No need to do anything more.
		* - Those that are downloading will be handled as the download finishes as part of a previous pass.
		*
		* Keeps (returns `true` for)
		*
		* - Original: these need to be cancelled
		* - Cancelled and Failed: these need to request cache.
		*
		* **This method does not touch the `src` attribute, it only looks at the states.**
		*
		* @param imageElement
		* @returns `false` if state of {@link imageElement} is one of the above mentioned irrelevant states.
		*/
	public static filterIrrelevantCacheStates(imageElement: HTMLImageElement) {
		Env.log.d("ProcessingPass:filterIrrelevantCacheStates");
		const state = HtmlAssistant.cacheState(imageElement)

		// return HtmlAssistant.isCacheStateEqual(state, [HTMLElementCacheState.ORIGINAL, HTMLElementCacheState.ORIGINAL_SRC_REMOVED, HTMLElementCacheState.CACHE_FAILED]);

		// Difference between this and the above is that ORIGINAL matches all unprocessed elements.
		return !HtmlAssistant.isCacheStateEqual(state,
			HTMLElementCacheState.REQUESTING,
			HTMLElementCacheState.REQUESTING_DOWNLOADING,
			HTMLElementCacheState.CACHE_SUCCEEDED,
			HTMLElementCacheState.INVALID
		);
	}

	/** Makes sure that elements requesting cache, waiting for download, or already cached, are not released when {@link end} is called. */
	public handleRequestingAndSucceeded(imageElements: HTMLImageElement[]) {
		Env.log.d("ProcessingPass:handleRequestingAndSucceeded:", imageElements);

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

	public static abortIfMode(ctx: ProcessingContext, ...modes: ObsViewMode[]) {
		for (const mode of modes) {
			if (ctx.viewingMode === mode) {
				ctx.logr.log(ctx.logr.abortMsg("Viewing mode:", ctx.viewingMode));
				return true;
			}
		}
		return false;
	}

	/** Must be called **before any other aborts** because this method simply looks at `info.seqNum === 0` to catch the first update call (rather than using a separate bool `info.seqNum < info.newFileDetectedAtSeqNum`). */
	public static abortIfInvalidContext(ctx: ProcessingContext, plugin: EditorViewPlugin, info: EditorViewPluginInfo) {
		if (ctx.associatedFile === null) {
			ctx.logr.log(ctx.logr.msg("abortIfInvalidContext: no file, continuing as a read only pass"));
			return false;
		}

		ctx.assertViewUpdateContext();
		const editorView = ctx.vuCtx.viewUpdate.view;

		const data = plugin.getViewMetadata(editorView);
		const associatedFilePath = ctx.associatedFile.path;
		const viewFilePath = data.requesterPath;

		// A change has definitely occured in that another path was set.
		if (viewFilePath !== associatedFilePath) {
			// As view update calls are handled by CodeMirror and the file path retreived from Obsidian API,
			// the `contentDOM` of the `EditorView` might not yet have been updated to reflect the content if the new
			// file that is about to be displayed.
			// Therefore, continuing in this state would cause dom elements to be associated with the wrong file
			// in the few update events that occurs until the `contentDOM` reflects the content of the new file.
			// The results in cache items being removed and downloaded until the state stabalizes again (i.e. `contentDOM` = file content).

			// However, each time a new file is initiated with the EditorView, the current view plugin is destroyed and a new instantiated.
			// The first view update of a fresh view plugin has been shown to contain the `contentDOM` reflecting the file.

			if (info.seqNum === 0) {
				ctx.logr.log(ctx.logr.msg("analyzeViewUpdate: New file detected."));
				data.requesterPath = associatedFilePath;
				plugin.setViewMetadata(editorView, data);
				return false;
			}
			else {
				ctx.logr.log(ctx.logr.msg("analyzeViewUpdate: waiting..., current seq num:", info.seqNum));
				return true;
			}
		}

		return false;
	}
}
