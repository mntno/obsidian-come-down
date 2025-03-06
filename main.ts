import { MarkdownView, Plugin, editorLivePreviewField, editorInfoField, MarkdownFileInfo, MarkdownPostProcessorContext, Notice, debounce, normalizePath } from "obsidian";
import { SETTING_NAME, SettingTab, SettingsManager } from "src/SettingTab";
import { CacheManager, CacheMetadataItem, CacheResourceType } from "src/CacheManager";
import { EditorView, ViewUpdate } from "@codemirror/view";

export default class PluginImplementation extends Plugin {
	settingsManager: SettingsManager;
	cacheManager: CacheManager;

	async onload() {

		//#region Settings 

		this.settingsManager = new SettingsManager(
			await this.loadData(),
			async (settings) => await this.saveData(settings),
			(name) => {
				if (name === SETTING_NAME.gitIgnoreCacheDir)
					this.ensureCacheDir();
			}
		);
		this.addSettingTab(new SettingTab(this, this.settingsManager));
		
		//#endregion
		
		//#region Cache 
		
		this.cacheManager = new CacheManager(this.app, this.cacheDir);
		this.ensureCacheDir();
		
		//#endregion

		//#region Register 

		// The post processor runs after the Markdown has been processed into HTML. It lets you add, remove, or replace HTML elements to the rendered document.
		this.registerMarkdownPostProcessor((element, context) => {
			this.processReadingView(element, context);
		});

		// Handle live preview
		this.registerEditorExtension(EditorView.updateListener.of((update: ViewUpdate) => {
			this.processLivePreview(update);
		}));

		this.addCommand({
			id: "clear-all-cache",
			name: "Clear All Cached Files",
			callback: () => {
				this.cacheManager.clearCached();
			}
		});

		this.addCommand({
			id: 'redownload-all-images-in-this-file',
			name: 'Redownload all images in this file.',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					if (!checking) {
					}
					return true;
				}
			}
		});

		//#endregion
	}

	onunload() {
		this.cacheManager?.cancelAllOngoing();
	}

	/**
	 * Will be set once it's ensured that `this.manifest.dir` is set. 
	 * @throws {Error} - If this.manifest.dir isn't set.
	 */
	get cacheDir(): string {
		if (this._cacheDir === undefined) {
			const pluginDir = this.manifest.dir;
			if (pluginDir) {
				this._cacheDir = `${pluginDir}/cache`;
			}
			else {
				const errorMsg = `${this.manifest.name}: Cannot load because plugin directory is unknown`;
				new Notice(errorMsg);
				throw new Error(errorMsg);
			}
		}
		return this._cacheDir;
	}
	_cacheDir: string | undefined;

	async ensureCacheDir() {
		const ensureGitIgnore = this.settingsManager.settings.gitIgnoreCacheDir;

		const cacheFolderExists = await this.app.vault.adapter.exists(this.cacheDir);
		if (!cacheFolderExists)
			await this.app.vault.adapter.mkdir(this.cacheDir);

		const gitignorePath = `${this.cacheDir}/.gitignore`;
		const gitignoreExists = await this.app.vault.adapter.exists(gitignorePath);

		if (ensureGitIgnore && !gitignoreExists)
			await this.app.vault.adapter.write(gitignorePath, "*");
		else if (!ensureGitIgnore && gitignoreExists)
			await this.app.vault.adapter.remove(gitignorePath);
	}

	processLivePreview(update: ViewUpdate) {
		const view = update.view;
		const isInLivePreview = view.state.field(editorLivePreviewField);
		if (!isInLivePreview)
			return;

		if (update.docChanged || update.viewportChanged) {

			const imageElements = view.contentDOM.findAll("img") as HTMLImageElement[];

			/* Gave up with this. Not sure if it's more efficient.
			syntaxTree(view.state).iterate({			
				enter: ({ type, from, to }: SyntaxNodeRef) => {
					console.log(`${view.state.doc.sliceString(from, to)}`);
				}
			});
			*/

			const markdownView = view.state.field(editorInfoField) as MarkdownFileInfo;
			this.handleImages(imageElements, markdownView.file?.path);
		}
	}

	processReadingView(element: HTMLElement, context: MarkdownPostProcessorContext) {
		const imageElements = element.findAll("img") as HTMLImageElement[];
		this.handleImages(imageElements, context.sourcePath);
	}

	/**
	 * Initiates a call to the {@link CacheManager} for each image element and changing the src to the cached file.
	 * 
	 * @param imageElements All images in the post proceessed HTML.
	 * @param filePath Path to the file containing this HTML.
	 */
	handleImages(imageElements: HTMLImageElement[], filePath: string | undefined) {

		//if (filePath)
		//	this.cacheManager.cancelOngoing(filePath);

		imageElements
			.filter((imageElement => imageElement.src.length > 0)) // In case src hasn't been set yet.
			.filter((imageElement) => imageElement.dataset.comeDownCacheInitiated !== "true") // Avoid stampede.
			.forEach((imageElement) => {

				const metadata: CacheMetadataItem = {
					key: imageElement.src,
					filePath: filePath,
					type: CacheResourceType.ExternalImage
				};

				const originalAltText = imageElement.alt;

				imageElement.alt = "Loading...";
				imageElement.dataset.comeDownCacheInitiated = "true";
				imageElement.src = `data:image/svg+xml;charset=utf-8,${PluginImplementation.ENCODED_LOADING_ICON}`;

				console.log(`handleImage: ${metadata.key}, alt: ${originalAltText}`);

				this.cacheManager.getCache(metadata, (result) => {
					imageElement.alt = originalAltText;

					if (result.item) {
						console.log(`Got CacheResult from cache: ${result.fromCache}, src: ${result.item?.metadata.key}`);
						imageElement.src = result.item.filePath;
					}
					else
						console.error("Failed to fetch cache", result.error);
				});
			});
	}

	/**
	 * @todo
	 * @see {@link https://lucide.dev/icons/loader}
	 */
	static readonly SVG_LOADING_ICON = `
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="transparant"
			stroke="currentColor"
			stroke-width="1"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M12 2v4" />
			<path d="m16.2 7.8 2.9-2.9" />
			<path d="M18 12h4" />
			<path d="m16.2 16.2 2.9 2.9" />
			<path d="M12 18v4" />
			<path d="m4.9 19.1 2.9-2.9" />
			<path d="M2 12h4" />
			<path d="m4.9 4.9 2.9 2.9" />
		</svg>
	`;

	static readonly ENCODED_LOADING_ICON = encodeURIComponent(PluginImplementation.SVG_LOADING_ICON);
}

