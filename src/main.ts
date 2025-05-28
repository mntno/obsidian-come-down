import { EditorView, ViewUpdate } from "@codemirror/view";
import { Plugin, MarkdownPostProcessorContext, normalizePath, TFile } from "obsidian";
import { SettingTab, SettingsManager, PluginSettings } from "Settings";
import { CacheFetchError, CacheItem, CacheManager, CacheRequest, CacheTypeError } from "CacheManager";
import { Log, Notice, ENV, clearBrowserCache } from "Environment";
import { HTMLElementAttribute, HTMLElementCacheState, HtmlAssistant } from "HtmlAssistant";
import { InfoModal } from "InfoModal";
import { ProcessingPass } from "ProcessingPass";
import { Url } from "Url";
import { Workarounds } from "Workarounds";

interface PluginData {
	settings: PluginSettings;
}

const DEFAULT_DATA: PluginData = {
	settings: SettingsManager.DEFAULT_SETTINGS,
} as const;

export default class ComeDownPlugin extends Plugin {
	private data: PluginData;
	private settingsManager: SettingsManager;
	private cacheManager: CacheManager;

	async onload() {

		//#region Init

		//const startTime = performance.now();

		Notice.setName(this.manifest.name);

		this.data = await ComeDownPlugin.loadPluginData(this);

		await this.ensureCacheDir();
		await this.ensureGitIgnore();

		this.cacheManager = await CacheManager.create(this.app.vault, this.cacheDir, this.cacheMetadataPath, [this.gitIgnorePath]);

		this.settingsManager = new SettingsManager(
			this.data.settings,
			async (_settings) => await this.saveData(this.data),
			(name) => {
				if (name === SettingsManager.SETTING_NAME.gitIgnoreCacheDir)
					this.ensureGitIgnore();
			}
		);
		this.addSettingTab(new SettingTab(this, this.settingsManager, this.cacheManager));

		//console.log(`ComeDown: init: ${performance.now() - startTime} milliseconds`);

		//#endregion

		//#region Register

		this.registerMarkdownPostProcessor((e, c) => this.postProcessReadingModeHtml(e, c));
		this.registerEditorExtension(EditorView.updateListener.of((vu) => this.editorViewUpdateListener(vu)));

		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile) {
					this.cacheManager.removeRetainer(file.path).then(() => this.cacheManager.saveMetadataIfDirty());
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile) {
					this.cacheManager.renameRetainer(oldPath, file.path);
					this.cacheManager.saveMetadataIfDirty();
				}
			})
		);

		this.registerInterval(
			window.setInterval(() => this.cacheManager.onMetadataFileChangedExternally().catch(console.error),
			5000
		));

		if (ENV.dev) {

			this.addCommand({
				id: "open-info-modal",
				name: "Cacheboard",
				callback: () => {
					new InfoModal(this.app, this.cacheManager, this.settingsManager.settings).open();
				}
			});

			this.addCommand({
				id: "delete-all-cache-and-reload",
				name: "Delete cache and reload",
				callback: () => {
					this.cacheManager.clearCached((error) => {
						if (error)
							console.error("Failed to clear cache", error);
						else
							clearBrowserCache(this.app);
					});
				}
			});
		}

		//#endregion

	}

	async onunload() {
		await this.cacheManager?.cancelAllOngoing();
	}

	onExternalSettingsChange?() {
		if (this.data) {
			ComeDownPlugin.loadPluginData(this).then(data => {
				this.data = data;
				this.settingsManager.onSettingsChangedExternally(this.data.settings);
			})
		}
	}

	private static async loadPluginData(plugin: Plugin): Promise<PluginData> {
		const data = await plugin.loadData(); // Returns `null` if file doesn't exist.
		return Object.assign({}, DEFAULT_DATA, data);
	}

	//#region Cache Init

	/**
	 * Will be set once it's ensured that `this.manifest.dir` is set.
	 * @throws {Error} If `this.manifest.dir` isn't set.
	 */
	get cacheDir(): string {
		if (this.cacheDirBacking === undefined) {
			const pluginDir = this.manifest.dir;
			if (pluginDir) {
				this.cacheDirBacking = normalizePath(`${pluginDir}/cache`);
				this.gitIgnorePath = normalizePath(`${this.cacheDirBacking}/.gitignore`);
				this.cacheMetadataPath = normalizePath(`${pluginDir}/cache.json`);
			}
			else {
				const errorMsg = `Cannot load because plugin directory is unknown`;
				new Notice(errorMsg);
				throw new Error(errorMsg);
			}
		}
		return this.cacheDirBacking;
	}
	private cacheDirBacking?: string;
	private gitIgnorePath: string;
	private cacheMetadataPath: string;

	/**
	 * Ensures the cache directory exists.
	 *
	 * Do not catch {@link Error}s so as to prevent the plugin from being enabled in such cases.
	 */
	async ensureCacheDir() {
		const cacheFolderExists = await this.app.vault.adapter.exists(this.cacheDir);
		if (!cacheFolderExists)
			await this.app.vault.adapter.mkdir(this.cacheDir);
	}

	/**
	 * Make sure a `.gitignore` file is added/removed.
	 */
	async ensureGitIgnore() {
		const ensureGitIgnore = this.data.settings.gitIgnoreCacheDir;
		const gitignoreExists = await this.app.vault.adapter.exists(this.gitIgnorePath);
		if (ensureGitIgnore && !gitignoreExists)
			await this.app.vault.adapter.write(this.gitIgnorePath, "*");
		else if (!ensureGitIgnore && gitignoreExists)
			await this.app.vault.adapter.remove(this.gitIgnorePath);
	}

	//#endregion

	//#region Processing

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
	 * @returns
	 */
	private filterIrrelevantCacheStates(imageElement: HTMLImageElement) {

		const state = HtmlAssistant.cacheState(imageElement)

		// return HtmlAssistant.isCacheStateEqual(state, [
		// 	HTMLElementCacheState.ORIGINAL,
		// 	HTMLElementCacheState.ORIGINAL_SRC_REMOVED,
		// 	HTMLElementCacheState.CACHE_FAILED
		// ]);

		// Difference between this and the above is that ORIGINAL matches all unprocessed elements.
		return !HtmlAssistant.isCacheStateEqual(state, [
			HTMLElementCacheState.REQUESTING,
			HTMLElementCacheState.REQUESTING_DOWNLOADING,
			HTMLElementCacheState.CACHE_SUCCEEDED,
			HTMLElementCacheState.INVALID
		]);
	}

	private editorViewUpdateListener(update: ViewUpdate) {

		const sourcesToIgnore = Workarounds.detectSourcesOfInvalidImageElements(update);

		const processingPass = ProcessingPass.beginFromViewUpdate(this.app, update, () => {
			// There is no file to work with. All that can be done is to cancel loading.
			const imageElements = HtmlAssistant.findRelevantImagesToProcess(update.view.contentDOM, true, (imageElement) => {
				const src = imageElement.getAttribute(HTMLElementAttribute.SRC);

				// Filter out image elements without a src or invalid.
				if (src === null || !Workarounds.HandleInvalidImageElements(sourcesToIgnore, imageElement, src))
					return false;

				// Allow image elements with external urls through so they can be cancelled.
				return Url.isValid(src) && Url.isExternal(src);
			});
			HtmlAssistant.cancelImageLoading(imageElements);
		});

		if (!processingPass)
			return;

		// Elements in DOM at this stage might be in states in which the `src` attribute has been removed. Therefore the `src` attribute is not required when finding image elements.
		const imageElements = HtmlAssistant.findRelevantImagesToProcess(update.view.contentDOM, false, (imageElement) => {
			const src = imageElement.getAttribute(HTMLElementAttribute.SRC);

			// 1. The user is editing the link (causing the source attribute to change) which resets the element's state.
			//    External urls are only accepted in the element's original state.
			if (update.docChanged && src && Url.isExternal(src) && HtmlAssistant.cacheState(imageElement) != HTMLElementCacheState.ORIGINAL)
				HtmlAssistant.resetElement(imageElement); // Set state to "untouched".

			// 2. As all images are retained in each pass, even though elements that are already cached are excluded from further processing, they still need to be retained.
			if (HtmlAssistant.cacheState(imageElement) == HTMLElementCacheState.CACHE_SUCCEEDED) {
				const src = HtmlAssistant.originalSrc(imageElement);
				console.assert(src !== null, "Expected original source dataset");
				if (src)
					processingPass.retainCacheFromRequest({ source: src, requesterPath: processingPass.associatedFile.path });
			}

			// 3. If there's no src there's nothing left to do but to remove all states that have passed this stage already.
			if (src === null)
				return this.filterIrrelevantCacheStates(imageElement);

			// 4. Only external urls are relevant.
			if (!(Url.isValid(src) && Url.isExternal(src)))
				return false;

			// 5. Filter out invalid.
			if (!Workarounds.HandleInvalidImageElements(sourcesToIgnore, imageElement, src))
				return false;

			// 5. Remove all states that have passed this stage already.
			return this.filterIrrelevantCacheStates(imageElement);
		});

		if (imageElements.length > 0) {
			HtmlAssistant.cancelImageLoading(imageElements);
			this.enqueue(async () => {
				await this.requestCache(imageElements, processingPass);
			});
		}
		else {
			// Special case when the user deletes an existing embed and all other image elements were filtered out: there are either no other embeds or all the other are already done.
			if (update.docChanged)
				processingPass.end(this.cacheManager);
			else
				processingPass.abort();
		}
	}

	/**
	 * - Will not be called if never in Read mode since there's no need to render Markdown.
	 * - In Read mode, it will always be called after the update listener, {@link editorViewUpdateListener}, as it might make changes.
	 *
	 * @param element A chunk of HTML.
	 * @param context
	 */
	private postProcessReadingModeHtml(element: HTMLElement, context: MarkdownPostProcessorContext) {

		const processingPass = ProcessingPass.beginFromPostProcessorContext(this.app, context);
		const imageElements = HtmlAssistant.findRelevantImagesToProcess(element, true, (imageElement) => {
			const src = imageElement.getAttribute(HTMLElementAttribute.SRC);
			return src !== null && Url.isValid(src) && Url.isExternal(src);
		});

		if (imageElements.length > 0) {
			HtmlAssistant.cancelImageLoading(imageElements);
			this.enqueue(async () => {
				await this.requestCache(imageElements, processingPass);
			});
		}
		else {
			processingPass.abort();
		}
	}

	private enqueue(operation: () => Promise<void>): Promise<void> {
		this.serialQueue = this.serialQueue.then(() => operation());
		return this.serialQueue;
	}
	private serialQueue: Promise<void> = Promise.resolve();

	/**
	 *
	 * @param imageElements
	 * @param processingPass
	 * @returns
	 */
	async requestCache(imageElements: HTMLImageElement[], processingPass: ProcessingPass) {

		imageElements = imageElements.filter((imageElement) => HtmlAssistant.isElementCacheStateEqual(imageElement, [HTMLElementCacheState.ORIGINAL_SRC_REMOVED, HTMLElementCacheState.CACHE_FAILED]));

		Log(`requestCache\n\tGot ${imageElements.length} <img> elements to populate: ID ${processingPass.passID}`);
		if (imageElements.length == 0)
			return;

		await this.cacheManager.onMetadataFileChangedExternally();

		const requestGroups = groupRequests(imageElements, this.cacheManager, processingPass);

		// First try to get src from local cache.
		for (const requestGroup of requestGroups) {
			const existingCacheResult = await this.cacheManager.existingCache(requestGroup.request, true);
			Log(`requestCache: ${existingCacheResult.item ? "Found" : "Did not find"} key ${existingCacheResult.cacheKey}. ${existingCacheResult.fileExists === undefined ? "Unknown if file exists." : `${existingCacheResult.fileExists ? "File exists." : "File does not exist."}`}`);
			if (existingCacheResult.item)
				await handleRequestGroup(existingCacheResult.item, requestGroup);
		};

		const remainingRequestGroups = requestGroups.filter((requestGroup) => !requestGroup.cacheFileFound);
		let numberOfRemainingDownloads = remainingRequestGroups.length;

		if (numberOfRemainingDownloads == 0) {
			Log(`requestCache: All images were in cache. Done ${processingPass.passID}`);
			processingPass.end(this.cacheManager);
			return;
		}

		// If we are here, some images need to be downloaded.

		// Show download notice
		if (this.settingsManager.settings.noticeOnDownload) {
			processingPass.runInUpdatePass(() => {
				const notice = `↓ ${numberOfRemainingDownloads}`;
				new Notice(notice, undefined, this.settingsManager.settings.omitNameInNotice);
			});
		}

		remainingRequestGroups.forEach((requestGroup) => {

			for (const imageElement of requestGroup.imageElements) {
				HtmlAssistant.setCacheState(imageElement, HTMLElementCacheState.REQUESTING_DOWNLOADING);
				HtmlAssistant.setLoadingIcon(imageElement);
				imageElement.setAttribute(HTMLElementAttribute.ALT, "Loading...");
			};

			// Pass `true` flag because it is known at this point that the cache doesn't exist.
			this.cacheManager.getCache(requestGroup.request, true, async (result) => {

				numberOfRemainingDownloads--;
				const imageElements: HTMLImageElement[] = requestGroup.imageElements;

				// Restore alt texts.
				imageElements.forEach((imageElement, index) => {
					const originalAlt = requestGroup.altAttributeValues[index];
					if (originalAlt.length > 0)
						imageElement.setAttribute(HTMLElementAttribute.ALT, originalAlt);
					else
						imageElement.removeAttribute(HTMLElementAttribute.ALT); // TODO: Chromium sets it to the original url if removed?
				});

				if (result.item) {
					Log(`requestCache:\n\tSettings src on ${imageElements.length} images\n\t${result.item.metadata.f.n}\n\t${processingPass.isInPostProcessingPass ? `In HTML post processor` : `In edit listener`}`);
					if (result.fileExists === true)
						await handleRequestGroup(result.item, requestGroup);
					else
						imageElements.forEach((imageElement) => HtmlAssistant.setFailed(imageElement));
				}
				else {
					imageElements.forEach((imageElement) => HtmlAssistant.setInvalid(imageElement));

					if (ENV.debugLog && (result.error instanceof CacheFetchError || result.error instanceof CacheTypeError))
						console.error(`requestCache:\n\t${result.error.name}`, result.error);

					if (!(result.error instanceof CacheFetchError || result.error instanceof CacheTypeError))
						console.error("requestCache:\n\tFailed to fetch cache", result.error);
				}

				if (numberOfRemainingDownloads == 0) {
					processingPass.end(this.cacheManager);
					if (result.error instanceof CacheFetchError && result.error.isInternetDisconnected)
						new Notice("No internet connection.");
				}
			});
		});

		/**
		 * - Uses the cache item to load each image element in the request group.
		 * - Sets the resulting {@link HTMLElementCacheState}.
		 * - Sets {@link RequestGroup.cacheFileFound}
		 * - Marks the src reference as retained.
		 *
		 * @param cacheItem
		 * @param requestGroup
		 */
		async function handleRequestGroup(cacheItem: CacheItem, requestGroup: RequestGroup) {
			const imageElements = requestGroup.imageElements;
			const errorResult = await HtmlAssistant.loadImages(imageElements, cacheItem.resourcePath);

			if (errorResult) {
				// File as not found on disk.
				console.error(errorResult.error);
				//imageElements.forEach((imageElement) => HtmlAssistant.setFailed(imageElement));
			}
			else {
				imageElements.forEach((imageElement) => HtmlAssistant.setCacheState(imageElement, HTMLElementCacheState.CACHE_SUCCEEDED));
			}

			requestGroup.cacheFileFound = errorResult ? false : true;

			if (requestGroup.cacheFileFound) {
				Log(`requestCache:handleRequestGroup: Found cached image: ${CacheManager.createCacheKeyFromMetadata(cacheItem.metadata)}, ID ${processingPass.passID} 📦📦📦`);
				processingPass.retainCacheFromRequest(requestGroup.request);
			}
		}

		/**
		 * - Create {@link CacheRequest} for each unique image source.
		 * - Group images per unique request.
		 * - Set the state to {@link HTMLElementCacheState.REQUESTING} on each element.
		 * - Retain info that could be overwritten while making the request to be able to restore it afterwards.
		 *
		 * @param imageElements
		 * @param processingPass
		 * @returns
		 */
		function groupRequests(imageElements: HTMLImageElement[], cacheManager: CacheManager, processingPass: ProcessingPass) {

			const groupedByRequest: Record<string, RequestGroup> = {};

			imageElements.forEach((imageElement) => {
				HtmlAssistant.setCacheState(imageElement, HTMLElementCacheState.REQUESTING);

				const src = HtmlAssistant.imageElementOriginalSrc(imageElement);

				if (src) {
					const key = CacheManager.createCacheKeyFromOriginalSrc(src);
					const group = groupedByRequest[key];
					const alt = imageElement.hasAttribute(HTMLElementAttribute.ALT) ? imageElement.alt : "";

					if (group) {
						group.imageElements.push(imageElement);
						group.altAttributeValues.push(alt);
					}
					else {
						const request: CacheRequest = { source: src, requesterPath: processingPass.associatedFile.path };
						const validationError = cacheManager.validateRequest(request);
						if (validationError) {
							console.error(`Cache request failed validation.`, validationError)
							HtmlAssistant.setInvalid(imageElement);
						}
						else {
							groupedByRequest[key] = {
								request,
								imageElements: [imageElement],
								altAttributeValues: [alt],
								cacheFileFound: false,
							};
						}
					}
				}
				else {
					console.error(`Image element does not have a source. Omitting.`)
					HtmlAssistant.setInvalid(imageElement);
				}
			});

			return Object.values(groupedByRequest);
		}
	}

	//#endregion
}

/**
 * Group of images that share the same cash request.
 */
interface RequestGroup {
	request: CacheRequest,
	imageElements: HTMLImageElement[],
	altAttributeValues: string[],
	/**
	 * Set to true to indicate that the cache was available and there's no need to download it.
	 * @description This is just a helper because one could iterate the image elements and check the {@link HTMLElementCacheState} to find out.
	 */
	cacheFileFound: boolean,
}
