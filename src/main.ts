import { EditorView, ViewUpdate } from "@codemirror/view";
import { MarkdownPostProcessorContext, Plugin, TFile, normalizePath } from "obsidian";
import { CacheFetchError, CacheItem, CacheManager, CacheRequest, CacheTypeError } from "./CacheManager";
import { Env } from "./Env";
import { HTMLElementAttribute, HTMLElementCacheState, HtmlAssistant } from "./HtmlAssistant";
import { ProcessingPass } from "./ProcessingPass";
import { PluginSettings, SettingTab, SettingsManager } from "./Settings";
import { InfoModal } from "./ui/InfoModal";
import { Notice } from "./ui/Notice";
import { File } from "./utils/File";
import { ObsAssistant } from "./utils/ObsAssistant";


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
		Env.log.d("Plugin:onload");

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

		this.registerEditorExtension(EditorView.updateListener.of((vu) => this.editorViewUpdateListener(vu)));
		this.registerMarkdownPostProcessor((e, c) => this.markdownPostProcessor(e, c));

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

		this.app.workspace.onLayoutReady(() => {
			setTimeout(() => this.removeSyncConflictFiles(), 1000);
			this.registerInterval(window.setInterval(() => this.cacheManager.checkIfMetadataFileChangedExternally().catch(Env.log.e), 1000 * 60 * 10));

			if (Env.isDev) {
				this.addCommand({
					id: "open-info-modal",
					name: "Cacheboard",
					callback: () => {
						this.cacheManager.checkIfMetadataFileChangedExternally()
							.then(() => new InfoModal(this.app, this.cacheManager, this.settingsManager.settings).open())
							.catch(Env.log.e);
					}
				});

				this.addCommand({
					id: "delete-all-cache-and-reload",
					name: "Delete cache and reload",
					callback: () => {
						this.cacheManager.clearCached((error) => {
							if (error)
								Env.log.e("Failed to clear cache", error);
							else
								Env.clearBrowserCache(this.app);
						});
					}
				});
			}
		});
	}

	async onunload() {
		Env.log.d("Plugin:onunload");
		await this.cacheManager?.cancelAllOngoing();
	}

	public onExternalSettingsChange() {
		Env.log.d("Plugin:onExternalSettingsChange");
		if (this.data) {
			ComeDownPlugin.loadPluginData(this).then(data => {
				this.data = data;
				this.settingsManager.onSettingsChangedExternally(this.data.settings);
				setTimeout(() => this.cacheManager.checkIfMetadataFileChangedExternally(), 1000);
			})
		}
	}

	private static async loadPluginData(plugin: Plugin): Promise<PluginData> {
		Env.log.d("Plugin:loadPluginData");
		const data = await plugin.loadData(); // Returns `null` if file doesn't exist.
		return Object.assign({}, DEFAULT_DATA, data);
	}

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
				this.cacheMetadataPath = normalizePath(pluginDir + "/" + PluginFile.Dynamic.CACHE.NAME + PluginFile.Dynamic.CACHE.EXT);
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

	/** Make sure a `.gitignore` file is added/removed. */
	async ensureGitIgnore() {
		const ensureGitIgnore = this.data.settings.gitIgnoreCacheDir;
		const gitignoreExists = await this.app.vault.adapter.exists(this.gitIgnorePath);
		if (ensureGitIgnore && !gitignoreExists)
			await this.app.vault.adapter.write(this.gitIgnorePath, "*");
		else if (!ensureGitIgnore && gitignoreExists)
			await this.app.vault.adapter.remove(this.gitIgnorePath);
	}

	/**
		1. **Suffixes or Infixes Added to the Base Name**: This is the most common pattern. The original filename is preserved at ti inserted between them.
			- {filename} (conflicted copy) .{extension} (Dropbox)
			- {filename}-conflict-{timestamp}.{extension) (Syncthing)
			- {filename)_conflict-{timestamp}.{extension} (Nextcloud)
		2. **Suffixes Appended to the Full Filename**: In this pattern, the conflict marker is added after the original extension.
			- {filename}.{extension}.Conflict (Resilio Sync)
			- {filename}.{extension).orig (Git)
		3. **Prefixes Added to the Filename**: Some services, like Google Drive, might prepend text to the filename.
			-	Copy of {filename). {extension)
	 */
	private async removeSyncConflictFiles() {
		if (this.manifest.dir === undefined)
			return;

		const doNotDeleteFilter = (path: string) => {
			const info = File.getPathInfo(path);
			if (info.filename === PluginFile.Static.MAIN || info.filename === PluginFile.Static.MANIFEST || info.filename === PluginFile.Static.STYLES)
				return false;
			else if (info.basename === PluginFile.Dynamic.DATA.NAME && info.extension === PluginFile.Dynamic.DATA.EXT)
				return false;
			else if (info.basename === PluginFile.Dynamic.CACHE.NAME && info.extension === PluginFile.Dynamic.CACHE.EXT)
				return false;
			else
				return true;
		};

		try {

			const removedFiles: string[] = [];
			const listed = await this.app.vault.adapter.list(this.manifest.dir);

			for (const path of listed.files.filter(doNotDeleteFilter)) {
				const info = File.getPathInfo(path);
				const isDataConflictFile = info.basename.includes(PluginFile.Dynamic.DATA.NAME) && (info.extension.toLowerCase() === PluginFile.Dynamic.DATA.EXT || info.basename.includes(PluginFile.Dynamic.DATA.EXT));
				const isCacheConflictFile = info.basename.includes(PluginFile.Dynamic.CACHE.NAME) && (info.extension.toLowerCase() === PluginFile.Dynamic.CACHE.EXT || info.basename.includes(PluginFile.Dynamic.CACHE.EXT));

				if (isDataConflictFile || isCacheConflictFile) {
					Env.log.i("Detected sync conflict file. Deleting:", info.filename);
					await this.app.vault.adapter.remove(path);
					removedFiles.push(info.filename);
				}
			};

			if (this.settingsManager.settings.noticeOnDeleteSyncConflictFile && removedFiles.length > 0)
				new Notice(`Found ${removedFiles.length} sync conflict files which were deleted.`, 0, false);

		} catch (e) {
			Env.log.e(e);
		}
	}

	private editorViewUpdateListener(update: ViewUpdate) {
		Env.log.d("Plugin:editorViewUpdateListener");

		const pass = ProcessingPass.beginFromViewUpdate(this.app, update, { abortInSourceMode: true });
		if (!pass)
			return;

		// No need to cancel anything in source mode. In reader mode, just cancel then abort. Leave it to the markdown post processor.
		const [imagesToCancel] = pass.findRelevantImagesToProcessViewUpdate(update);
		HtmlAssistant.cancelImageLoading(imagesToCancel);

		if (pass.mode === "reader" || ComeDownPlugin.canAbortViewUpdate(imagesToCancel, update)) {
			pass.log(pass.abortLogMsg());
			return;
		}

		pass.enqueue(async () => {
			// Read again to get the latest states (e.g. downloading).
			const [imagesToProcess, remainingElements] = pass.findRelevantImagesToProcessViewUpdate(update);
			pass.log(Env.dev.icon.EDIT_UPDATE_PASS, Env.dev.thunkedStr(() => `Found ${imagesToProcess.length} of ${imagesToProcess.length + remainingElements.length} images to process in current DOM. Running in serial queue. ${pass.idString}`));

			if (ComeDownPlugin.canAbortViewUpdate(imagesToProcess, update)) {
				pass.log(pass.abortLogMsg());
			}
			else {

				pass.handleRequestingAndSucceeded(remainingElements);
				pass.handleImagesNotInCurrentDOM([...imagesToProcess, ...remainingElements]);

				// Special case when the user deletes an existing embed and all other image elements were filtered out: there are either no other embeds or all the other are already done.
				// Even when there are no more images to display, the user might remove image embeds, which needs to be removed from the cache as well.
				if (imagesToProcess.length === 0 && update.docChanged) {
					pass.log(pass.logMsg("Checking removals (no images to process but document changed)."));
					pass.end(this.cacheManager);
				}
				else {
					await this.requestCache(imagesToProcess, pass);
				}
			}
		});
	}

	/** Refactored out of {@link editorViewUpdateListener} as a safty and self-documenting measure. See where `update.docChanged` in {@link editorViewUpdateListener}. */
	private static canAbortViewUpdate = (elements: HTMLImageElement[], update: ViewUpdate) => elements.length === 0 && !update.docChanged;

	/**
		* @param element A chunk of HTML converted from markdown — not yet attached to the DOM.
		* @param context
		*/
	private markdownPostProcessor(element: HTMLElement, context: MarkdownPostProcessorContext) {
		Env.log.d("Plugin:markdownPostProcessor");

		const [imagesToProcess, remainingElements] = ProcessingPass.findRelevantImagesToProcessInPostProcessor(element, context, true);
		HtmlAssistant.cancelImageLoading(imagesToProcess);

		const pass = ProcessingPass.beginFromPostProcessorContext(this.app, context);
		if (pass === null)
			return;

		if (imagesToProcess.length === 0) {
			pass.log(pass.abortLogMsg());
			return;
		}

		pass.enqueue(async () => {
			pass.log(pass.logMsg("Running in serial queue."));

			const readerContainerEl = ObsAssistant.readerContainerEl(pass.contentEl ?? pass.containerEl);
			Env.assert(readerContainerEl);
			if (readerContainerEl === null) {
				pass.log(pass.abortLogMsg());
				return;
			}

			// Wait a bit for all (or some more) elements to be attached to the DOM so that requests can be grouped. This is solely to reduce the number of download notices; it does not affect functionality.
			await ProcessingPass.sleep(5);

			// Read again to get the latest states (e.g. downloading).
			const [imagesToProcessInDom, remainingElementsInDom] = ProcessingPass.findRelevantImagesToProcessInPostProcessor(readerContainerEl, context, false);

			// The element/chunk that was provided in this post processing callback is not within the viewport (+margin), but it needs to be handled now anyway because this callback is only called once for each chunk.
			let imagesToProcessInCurrentElement: HTMLImageElement[] = [];
			if (element.parentElement === null)
				[imagesToProcessInCurrentElement] = ProcessingPass.findRelevantImagesToProcessInPostProcessor(element, context, false);

			pass.log(pass.logMsg(Env.dev.thunkedStr(() => `Found ${imagesToProcessInDom.length} of ${imagesToProcessInDom.length + remainingElementsInDom.length} images in DOM and ${imagesToProcessInCurrentElement.length} images in current HTML chunk to process.`)));
			await this.requestCache([...imagesToProcessInDom, ...imagesToProcessInCurrentElement], pass);
		});
	}

	async requestCache(imageElements: HTMLImageElement[], pass: ProcessingPass) {

		imageElements = imageElements.filter((imageElement) => HtmlAssistant.isElementCacheStateEqual(imageElement, HTMLElementCacheState.ORIGINAL_SRC_REMOVED, HTMLElementCacheState.CACHE_FAILED));

		pass.log(Env.dev.thunkedStr(() => pass.logMsg(`requestCache\n\tGot ${imageElements.length} <img> elements to populate.`)));
		if (imageElements.length == 0) {
			pass.log(pass.abortLogMsg());
			return;
		}
		await this.cacheManager.checkIfMetadataFileChangedExternally();

		const requestGroups = groupRequests(imageElements, this.cacheManager, pass);

		// First try to get src from local cache.
		for (const requestGroup of requestGroups) {
			const existingCacheResult = await this.cacheManager.existingCache(requestGroup.request, true);
			pass.log(Env.dev.thunkedStr(() => pass.logMsg(`requestCache: ${existingCacheResult.item ? "Found" : "Did not find"} key ${existingCacheResult.cacheKey}. ${existingCacheResult.fileExists === undefined ? "Unknown if file exists." : `${existingCacheResult.fileExists ? "File exists." : "File does not exist."}`}`)));
			if (existingCacheResult.item)
				await handleRequestGroup(existingCacheResult.item, requestGroup);
		};

		const remainingRequestGroups = requestGroups.filter((requestGroup) => !requestGroup.cacheFileFound);
		let numberOfRemainingDownloads = remainingRequestGroups.length;

		if (numberOfRemainingDownloads == 0) {
			pass.log(pass.logMsg("requestCache: All images were in cache. Done."));
			pass.end(this.cacheManager);
			return;
		}

		// If we are here, some images need to be downloaded.

		// Show download notice
		if (this.settingsManager.settings.noticeOnDownload) {
			const notice = `↓ ${numberOfRemainingDownloads}`;
			new Notice(notice, undefined, this.settingsManager.settings.omitNameInNotice);
		}

		remainingRequestGroups.forEach((requestGroup) => {

			for (const imageElement of requestGroup.imageElements) {
				HtmlAssistant.setLoading(imageElement);
				imageElement.setAttribute(HTMLElementAttribute.ALT, "Loading...");
			};

			// Pass `true` flag because it is known at this point that the cache doesn't exist.
			this.cacheManager.getCache(requestGroup.request, true, async (result) => {

				numberOfRemainingDownloads--;
				const imageElements: HTMLImageElement[] = requestGroup.imageElements;

				// Restore alt texts.
				imageElements.forEach((imageElement, index) => {
					const originalAlt = requestGroup.altAttributeValues[index];
					if (originalAlt && originalAlt.length > 0)
						imageElement.setAttribute(HTMLElementAttribute.ALT, originalAlt);
					else
						imageElement.removeAttribute(HTMLElementAttribute.ALT); // TODO: Chromium sets it to the original url if removed?
				});

				if (result.item) {
					const resultItem = result.item;
					pass.log(Env.dev.thunkedStr(() => pass.logMsg(`requestCache:\n\tSettings src on ${imageElements.length} images\n\t${resultItem.metadata.f.n}\n\t${pass.isInPostProcessingPass ? `In HTML post processor` : `In edit listener`}`)));
					if (result.fileExists === true)
						await handleRequestGroup(resultItem, requestGroup);
					else
						imageElements.forEach((imageElement) => HtmlAssistant.setFailed(imageElement));
				}
				else {
					imageElements.forEach((imageElement) => HtmlAssistant.setInvalid(imageElement));

					if (Env.isDev && (result.error instanceof CacheFetchError || result.error instanceof CacheTypeError))
						pass.log(pass.logMsg(`requestCache: ${result.error.name}`), result.error);

					if (!(result.error instanceof CacheFetchError || result.error instanceof CacheTypeError))
						Env.log.e("requestCache:\n\tFailed to fetch cache", result.error);
				}

				if (numberOfRemainingDownloads == 0) {
					pass.end(this.cacheManager);
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
				Env.log.e(errorResult.error);
				//imageElements.forEach((imageElement) => HtmlAssistant.setFailed(imageElement));
			}
			else {
				imageElements.forEach((imageElement) => HtmlAssistant.setCacheState(imageElement, HTMLElementCacheState.CACHE_SUCCEEDED));
			}

			requestGroup.cacheFileFound = errorResult ? false : true;

			if (requestGroup.cacheFileFound) {
				pass.log(Env.dev.thunkedStr(() => pass.logMsg(`requestCache:handleRequestGroup: Found cached image: ${CacheManager.createCacheKeyFromMetadata(cacheItem.metadata)}, ID ${pass.passID} 📦📦📦`)));
				pass.retainCache(requestGroup.request);
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

				const src = HtmlAssistant.originalSrc(imageElement, true);

				if (src) {
					const key = CacheManager.createCacheKeyFromOriginalSrc(src);
					const group = groupedByRequest[key];
					const alt = imageElement.hasAttribute(HTMLElementAttribute.ALT) ? imageElement.alt : "";

					if (group) {
						group.imageElements.push(imageElement);
						group.altAttributeValues.push(alt);
					}
					else {
						const request = CacheManager.createRequest(src, processingPass.associatedFile.path);
						const validationError = cacheManager.validateRequest(request);
						if (validationError) {
							Env.log.e(`Cache request failed validation.`, validationError)
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
					Env.log.e(`Image element does not have a source. Omitting.`)
					HtmlAssistant.setInvalid(imageElement);
				}
			});

			return Object.values(groupedByRequest);
		}
	}
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

const PluginFile = {
	Static: {
		MANIFEST: "manifest.json",
		MAIN: "main.js",
		STYLES: "styles.css",
	} as const,
	Dynamic: {
		DATA: {
			NAME: "data",
			EXT: ".json",
		} as const,
		CACHE: {
			NAME: "cache",
			EXT: ".json",
		} as const,
	} as const,
} as const;
