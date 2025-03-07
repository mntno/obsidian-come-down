import { MarkdownView, Plugin, editorLivePreviewField, MarkdownPostProcessorContext, normalizePath, Platform, FileView, TFile } from "obsidian";
import { SettingTab, SettingsManager, PluginSettings } from "src/Settings";
import { CacheManager, CacheRequest } from "src/CacheManager";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { Log, Notice, ENV } from "src/Environment";
import { HTMLElementAttribute, HTMLElementCacheState, HtmlAssistant } from "src/HtmlAssistant";
import { GetCacheKey } from "./CacheMetadata";

interface PluginData {
	settings: PluginSettings;
}

export const DEFAULT_DATA: PluginData = {
	settings: SettingsManager.DEFAULT_SETTINGS,
} as const;

export default class ComeDownPlugin extends Plugin {
	private data: PluginData;
	private settingsManager: SettingsManager;
	private cacheManager: CacheManager;

	async onload() {

		Notice.setName(this.manifest.name);

		this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());

		//#region Settings 

		this.settingsManager = new SettingsManager(
			this.data.settings,
			async (_settings) => await this.saveData(this.data),
			(name) => {
				if (name === SettingsManager.SETTING_NAME.gitIgnoreCacheDir)
					this.ensureCacheDir();
			}
		);
		this.addSettingTab(new SettingTab(this, this.settingsManager));

		//#endregion

		//#region Cache 

		this.cacheManager = new CacheManager(this.app.vault, this.cacheDir);
		this.ensureCacheDir();

		//#endregion

		//#region Register 

		// The post processor runs after the Markdown has been processed into HTML. It lets you add, remove, or replace HTML elements to the rendered document.		
		this.registerMarkdownPostProcessor((e, c) => this.processReadingMode(e, c));

		this.registerEditorExtension(EditorView.updateListener.of((vu) => this.editorViewUpdateListener(vu)));

		this.addCommand({
			id: "clear-all-cache",
			name: "Clear All Cached Files",
			callback: async () => {
				await this.cacheManager.clearCached([this.gitIgnorePath], (error) => {
					if (error) {
						new Notice(`An error occured while clearing the cache: ${error.message}`, 0);
						console.error(`Error clearing cache: ${error}`);
					}
					else {
						new Notice(`Cache cleared.`);
						if (ENV.dev && Platform.isDesktopApp) {
							require('electron').remote.session.defaultSession.clearCache()
								.then(() => {
									new Notice('Electron Cache cleared successfully. Restart vault.');
								})
								.catch((error: any) => {
									console.error('Error clearing cache:', error);
								});
						}
					}
				});
			}
		});

		// this.addCommand({
		// 	id: 'redownload-all-images-in-this-file',
		// 	name: 'Redownload all images in this file.',
		// 	checkCallback: (checking: boolean) => {
		// 		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		// 		if (markdownView) {
		// 			if (!checking) {
		// 			}
		// 			return true;
		// 		}
		// 	}
		// });

		//#endregion
	}

	async onunload() {
		await this.cacheManager?.cancelAllOngoing();
	}

	//#region Cache

	/**
	 * Will be set once it's ensured that `this.manifest.dir` is set. 
	 * @throws {Error} - If this.manifest.dir isn't set.
	 */
	get cacheDir(): string {
		if (this.cacheDirBacking === undefined) {
			const pluginDir = this.manifest.dir;
			if (pluginDir) {
				this.cacheDirBacking = `${pluginDir}/cache`;
			}
			else {
				const errorMsg = `Cannot load because plugin directory is unknown`;
				new Notice(errorMsg);
				throw new Error(errorMsg);
			}
		}
		return this.cacheDirBacking;
	}
	private cacheDirBacking: string | undefined;

	get gitIgnorePath() {
		if (!this.gitIgnorePathBacking)
			this.gitIgnorePathBacking = normalizePath(`${this.cacheDir}/.gitignore`);
		return this.gitIgnorePathBacking;
	}
	private gitIgnorePathBacking: string | undefined;

	async ensureCacheDir() {
		const ensureGitIgnore = this.settingsManager.settings.gitIgnoreCacheDir;

		const cacheFolderExists = await this.app.vault.adapter.exists(this.cacheDir);
		if (!cacheFolderExists)
			await this.app.vault.adapter.mkdir(this.cacheDir);

		const gitignoreExists = await this.app.vault.adapter.exists(this.gitIgnorePath);

		if (ensureGitIgnore && !gitignoreExists)
			await this.app.vault.adapter.write(this.gitIgnorePath, "*");
		else if (!ensureGitIgnore && gitignoreExists)
			await this.app.vault.adapter.remove(this.gitIgnorePath);
	}

	//#endregion

	//#region 

	private isInLivePreviewFromView(view: FileView) {
		const state = view?.getState();
		return state ? state.mode == "source" && state.source == false : false;
	}

	private isInSourceModeFromView(view: FileView) {
		const state = view?.getState();
		return state ? state.mode == "source" && state.source == true : false;
	}

	private inLivePreviewFromEditorView(view: EditorView) {
		return view.state.field(editorLivePreviewField);
	}

	private getEditorRoot(element: HTMLElement): HTMLElement | null {
		let currentElement: HTMLElement | null = element;

		while (currentElement) {
			if (currentElement.classList.contains("view-content")) {
				return currentElement;
			}
			currentElement = currentElement.parentElement as HTMLElement | null;
		}

		return null; // Root not found
	}

	/**
	 * 
	 * @param view 
	 * @returns true if file is open in Reading view.
	 */
	private isInReadingViewFromView(view: FileView): boolean {
		return view?.getState().mode == "preview"; // "source"
	}

	private viewModeString(fileView: FileView, editorView: EditorView | undefined = undefined) {
		return this.isInReadingViewFromView(fileView) ? "Reading view (reading)" : "Live preview (editing)";
		//if (editorView)
		//	Log(`\t${!this.inLivePreviewFromEditorView(editorView) ? `Reading view (reading)` : `Live preview (editing)`}`)
	}

	/**
	 * Call first in system callbacks to abort as early as possible.
	 * @param context 
	 * @returns Do nothing further if `null`.
	 */
	private proceed(context?: MarkdownPostProcessorContext): { markdownView: MarkdownView, associatedFile: TFile } | null {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

		if (!markdownView) {
			Log(`\tSkipping because no active view.`);
			return null;
		}

		if (this.isInSourceModeFromView(markdownView)) {
			Log(`\tSkipping because in source mode.`);
			return null;
		}

		// if (ENV.usePostProcessor && this.isInReadingViewFromView(markdownView)) {
		// 	Log(`\tSkipping because in Reading view.`);
		// 	return null;
		// }

		const associatedFile = markdownView.file; // == this.app.workspace.getActiveFile()
		if (!associatedFile) {
			Log(`\tSkipping because in no associated file.`);
			return null;
		}

		if (context && associatedFile.path != context.sourcePath) {
			console.warn(`\tExpected \`getActiveFile().path\` be equal to \`sourcePath\` of \`MarkdownPostProcessorContext\``)
			return null;
		}

		return { markdownView, associatedFile: associatedFile };
	}
	
	/**
	 * Finds the relevant html elements under {@link element} then aims to further filter out those that are unwanted.
	 * 
	 * @param element 
	 * @returns 
	 */
	private imageElements(element: HTMLElement): HTMLImageElement[] {

		// Note that if the `src` attribute is used for an svg icon this method will regard it as relevant and return it. But it will be filtered when the state is checked.
		let imageElements = HtmlAssistant.findAllRelevantImages(element);
		
		if (imageElements.length == 0) {
			Log(`\tAborting: Found no relevant image elements.`)			
			return imageElements;
		} 
		else
			Log(`\tNumber of relevant image elements: ${imageElements.length}`);

		imageElements = imageElements.filter((imageElement) => {
			const state = HtmlAssistant.cacheState(imageElement)
			Log(`\tCache state: ${state}`);
			return state != HTMLElementCacheState.CACHE_SUCCEEDED && state != HTMLElementCacheState.CACHE_REQUESTED;
		});

		if (imageElements.length == 0)
			Log(`\tAborting: All relevant images are either already using cache or are waiting for it.`)

		return imageElements;
	}

	private editorViewUpdateListener(update: ViewUpdate) {
		Log(`editorViewUpdateListener`)
		
		const proceed = this.proceed();
		if (!proceed)
			return;

		Log(`\t${this.viewModeString(proceed.markdownView, update.view)}`);

		const imageElements = this.imageElements(update.view.contentDOM);
		if (imageElements.length == 0)
			return;		
		
		if (ENV.processOnAllViewUpdateChanges || (update.docChanged || update.viewportChanged || update.geometryChanged)) {
			if (!ENV.processOnAllViewUpdateChanges)
				Log(`\tdocChanged: ${update.docChanged}\n\tviewportChanged: ${update.viewportChanged}\n\tselectionSet: ${update.selectionSet}\n\tfocusChanged: ${update.focusChanged}\n\tgeometryChanged: ${update.geometryChanged}\n\theightChanged: ${update.heightChanged}`);

			this.handleImages(HtmlAssistant.preparedImageElements(imageElements), proceed.associatedFile);
		}
		else {
			if (!ENV.processOnAllViewUpdateChanges)
				Log(`\tskipped \`handleImages\`: \n\tviewportChanged: ${update.viewportChanged}\n\tselectionSet: ${update.selectionSet}\n\tfocusChanged: ${update.focusChanged}\n\tgeometryChanged: ${update.geometryChanged}\n\theightChanged: ${update.heightChanged}`);
		}
	}

	/**
	 * 
	 * @param element A chunk of html.
	 * @param context 
	 */
	processReadingMode(element: HTMLElement, context: MarkdownPostProcessorContext) {
		Log(`processReadingMode`)
		
		const proceed = this.proceed(context);
		if (!proceed)
			return;
		
		Log(`\t${this.viewModeString(proceed.markdownView)}`);
		
		const imageElements = this.imageElements(element);
		if (imageElements.length == 0)
			return;

		//console.log(element);			
		//console.log(context.getSectionInfo(element)?.text); // This is the Markdown text

		this.handleImages(HtmlAssistant.preparedImageElements(imageElements), proceed.associatedFile);
	}

	/**
	 * Initiates a call to the {@link CacheManager} for each image element and changing the src to the cached file.
	 * 
	 * @param imageElements All images in the post proceessed HTML.
	 * @param filePath Path to the file containing this HTML.
	 */
	async handleImages(imageElements: HTMLImageElement[], associatedFile: TFile) {

		imageElements = imageElements.length == 0
			? []
			: imageElements.filter((imageElement) => HtmlAssistant.cacheState(imageElement) == HTMLElementCacheState.ORIGINAL_CANCELLED);

		Log(`handleImages\n\tGot ${imageElements.length} <img> elements to populate.`);
		if (imageElements.length == 0)
			return;

		//#region Prepare requests and group equal elements (making it one request per file, not per element).

		const groupedByRequest: Record<string, {
			request: CacheRequest,
			filePath: string,
			data: Record<string, any>,
			done: boolean,
		}> = {};

		imageElements.forEach((imageElement) => {
			HtmlAssistant.setCacheState(imageElement, HTMLElementCacheState.CACHE_REQUESTED);

			const src = HtmlAssistant.imageElementOriginalSrc(imageElement);

			if (src) {
				const key = CacheManager.cacheKeyFromOriginalSrc(src);
				const group = groupedByRequest[key];
				const alt = imageElement.hasAttribute(HTMLElementAttribute.ALT) ? imageElement.alt : "";

				if (group) {
					group.data.imageElements.push(imageElement);
					group.data.originalAlts.push(alt);
				}
				else {
					const request = { key: src };
					const validationError = this.cacheManager.validateRequest(request);
					if (validationError) {
						console.error(`Image element does not have a source. Omitting.`)
						HtmlAssistant.setFailed(imageElement);
					}
					else {
						groupedByRequest[key] = {
							request,
							filePath: associatedFile.path,
							data: { imageElements: [imageElement], originalAlts: [alt] },
							done: false,
						};
					}
				}
			}
			else {
				console.error(`Image element does not have a source. Omitting.`)
				HtmlAssistant.setFailed(imageElement);
			}

		});
		//#endregion

		const requestGroups = Object.values(groupedByRequest); // TODO: Can be array.
		let numberFilesToDownload = 0;

		for (const requestGroup of requestGroups) {
			const cacheItem = await this.cacheManager.existingCachedItem(requestGroup.request);

			if (cacheItem) {
				requestGroup.data.imageElements.forEach((imageElement: HTMLImageElement) =>
					HtmlAssistant.setSuccess(imageElement, cacheItem.filePath));
				requestGroup.done = true;
				Log(`handleImages:\n\t Used available cache: ${GetCacheKey(cacheItem.metadata.hash)}`)
			}
			else {
				numberFilesToDownload++;
			}
		}

		if (this.settingsManager.settings.noticeOnDownload) {
			if (numberFilesToDownload > 0) {				
				const notice = `↓ ${numberFilesToDownload}`;// file${numberFilesToDownload != 1 ? `s` : ``}`;
				new Notice(notice, undefined, this.settingsManager.settings.omitNameInNotice);
				Log(`${associatedFile.path}: ${notice}`);
			}
		}
		
		requestGroups
			.filter((requestGroup) => !requestGroup.done)
			.forEach((requestGroup) => {

				const imageElements: HTMLImageElement[] = requestGroup.data.imageElements;
				imageElements.forEach((ie) => {
					HtmlAssistant.setIcon(ie, HtmlAssistant.ENCODED_LOADING_ICON);
					ie.setAttribute(HTMLElementAttribute.ALT, "Loading...");
				});

				// Fire and forget			
				this.cacheManager.getCache(requestGroup.request, (result) => {

					const imageElements: HTMLImageElement[] = requestGroup.data.imageElements;

					// Restore alt texts.
					const originalAlts: string[] = requestGroup.data.originalAlts;
					imageElements.forEach((imageElement, index) => {
						const originalAlt = originalAlts[index];
						if (originalAlt.length > 0)
							imageElement.setAttribute(HTMLElementAttribute.ALT, originalAlt);
						else
							imageElement.removeAttribute(HTMLElementAttribute.ALT); // TODO: Chromium sets it to the original url if removed?
					});

					if (result.item) {
						Log(`handleImages:\n\tCache result received. Settings src on ${imageElements.length} images\n\t${result.item.metadata.file.name}`)
						const filePath = result.item.filePath;
						imageElements.forEach((imageElement) => HtmlAssistant.setSuccess(imageElement, filePath));
					}
					else {
						console.error("Failed to fetch cache", result.error);
						imageElements.forEach((imageElement) => HtmlAssistant.setFailed(imageElement));
					}
				}, true);
			});
	}

	//#endregion
}

