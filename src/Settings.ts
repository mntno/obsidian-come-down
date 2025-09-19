import { Platform, Plugin, PluginSettingTab, Setting } from "obsidian";
import { CacheManager } from "./CacheManager";
import { Env } from "./Env";
import { Notice } from "./ui/Notice";

export interface PluginSettings {

	/** Show a {@link Notice} when file download starts. */
	noticeOnDownload: boolean;
	/** Show a {@link Notice} when sync conflict files were detected and deleted. */
	noticeOnDeleteSyncConflictFile: boolean;

	/** Remove the name of the plugin when showing the download message. */
	omitNameInNotice: boolean;

	/**
		* Whether to "gitignore" the cache dir.
		* When set to: `true`, make sure there's a `.gitignore` file in the cache directory; `false` to make sure otherwise.
		*
		* This can't be disabled in the UI. But those who take matters into their own hands with data.json...
		*/
	gitIgnoreCacheDir: boolean;

	showDebugInfo: boolean;
}

type SettingsChanged = (settings: PluginSettings) => void;

export class SettingsManager {
	public settings: PluginSettings;
	public save: () => Promise<void>;
	public onChangedCallback: (name: string, value: any) => void | undefined;

	static readonly DEFAULT_SETTINGS: PluginSettings = {
		noticeOnDownload: true,
		noticeOnDeleteSyncConflictFile: false,
		omitNameInNotice: false,
		gitIgnoreCacheDir: true,
		showDebugInfo: false,
	} as const;

	static readonly SETTING_NAME = {
		gitIgnoreCacheDir: "gitIgnoreCacheDir",
	} as const;

	constructor(settings: any, save: (settings: PluginSettings) => Promise<void>, onChangedCallback: (name: string, value: any) => void | undefined) {
		this.settings = settings;
		this.save = () => save(this.settings);
		this.onChangedCallback = onChangedCallback;
	}

	public onSettingsChangedExternally(settings: PluginSettings) {
		this.settings = settings;
		this.registeredChangedCallbacks.forEach(cb => cb(this.settings));
	}

	public registerOnChangedCallback(evt: SettingsChanged) {
		if (!this.registeredChangedCallbacks.includes(evt))
			this.registeredChangedCallbacks.push(evt);
	}

	public unregisterOnChangedCallback(evt: SettingsChanged) {
		this.registeredChangedCallbacks = this.registeredChangedCallbacks.filter(callback => callback !== evt);
	}

	private registeredChangedCallbacks: SettingsChanged[] = [];
}

export class SettingTab extends PluginSettingTab {
	private settingsManager: SettingsManager;
	private cacheManager: CacheManager;
	private isShown = false;

	constructor(plugin: Plugin, settingsManager: SettingsManager, cacheManager: CacheManager) {
		super(plugin.app, plugin);
		this.settingsManager = settingsManager;
		this.cacheManager = cacheManager;
	}

	public display(): void {
		Env.log.d("SettingTab:display: isShown", this.isShown);

		if (!this.isShown)
			this.settingsManager.registerOnChangedCallback(this.onChangedCallback);
		this.isShown = true;

		this.cacheManager.checkIfMetadataFileChangedExternally().then(() => this.render());
	}

	public hide(): void {
		Env.log.d("SettingTab:hide");
		if (this.isShown)
			this.settingsManager.unregisterOnChangedCallback(this.onChangedCallback);
		this.isShown = false;
	}

	private onChangedCallback = () => this.display();

	private async render() {
		const { containerEl } = this;
		const settings = this.settingsManager.settings;

		containerEl.empty();

		let compactDownloadMessage: Setting | undefined;
		const setCompactDownloadMessageVisibility = () => {
			if (settings.noticeOnDownload)
				compactDownloadMessage?.settingEl.show();
			else
				compactDownloadMessage?.settingEl.hide();
		};

		new Setting(containerEl)
			.setName("Display a message on download")
			.setDesc("Let’s you know when files are downloaded and how many.")
			.addToggle((toggle) => {
				toggle.setValue(settings.noticeOnDownload);
				toggle.onChange(async (value) => {
					settings.noticeOnDownload = value;
					setCompactDownloadMessageVisibility();
					await this.settingsManager.save();
				});
			});

		compactDownloadMessage = new Setting(containerEl)
			.setName("Use compact download message")
			.setDesc("Shortens the message to make it less distracting.")
			.addToggle((toggle) => {
				toggle.setValue(settings.omitNameInNotice);
				toggle.onChange(async (value) => {
					settings.omitNameInNotice = value;
					await this.settingsManager.save();
				});
			});
		setCompactDownloadMessageVisibility();

		const cachedFilesSetting = new Setting(containerEl).setName('Number of files cached');
		this.cacheManager.actualCachedFilePaths().then((filePaths) => {
			const num = filePaths.length;
			cachedFilesSetting.setDesc(`${num} file${num == 1 ? `` : `s`}.`);

			if (num == 0)
				return;

			cachedFilesSetting.addButton((button) => {
				button.buttonEl.tabIndex = -1;
				button.setButtonText("Delete all cached files");
				button.onClick(() => {
					button.setButtonText("Confirm cache delete");
					button.setWarning();
					button.onClick(async () => {

						await this.cacheManager.clearCached((error) => {
							if (error) {
								new Notice(`An error occured while clearing the cache: ${error.message}`, 0);
								Env.log.e("Error clearing cache.", error);
							}
							else {
								new Notice("Cache cleared");
								cachedFilesSetting.setDesc("Cache is empty.")

								button.buttonEl.remove();

								if (Env.isDev && Platform.isDesktopApp) {
									require('electron').remote.session.defaultSession.clearCache()
										.then(() => new Notice('Electron Cache cleared successfully. Restart vault.'))
										.catch((error: any) => Env.log.e('Error clearing cache:', error));
								}
							}
						});
					});
				});
			});
		}).catch(error => {
			Env.log.e("Failed to count cached files:", error);
			cachedFilesSetting.setDesc("Failed to count cached files.");
		});

		new Setting(containerEl)
			.setName("Advanced").setHeading();

		// This is more of an "info setting" assuring that a .gitignore file exists rather than allowing its removal.
		new Setting(containerEl)
			.setName("Exclude cache from Git")
			.setDesc(`Use a \`.gitignore\` file to prevent cached files from being visible to Git. Note that this option cannot be disabled here.`)
			.setClass("come-down-toggle-disabled")
			.addToggle((toggle) => {

				const refreshDisabled = () => {
					if (settings.gitIgnoreCacheDir) {
						toggle.setDisabled(true);
					}
				}

				refreshDisabled();
				toggle.setValue(settings.gitIgnoreCacheDir);
				toggle.onChange(async (value) => {
					settings.gitIgnoreCacheDir = value;
					await this.settingsManager.save();
					refreshDisabled();
					this.settingsManager?.onChangedCallback(SettingsManager.SETTING_NAME.gitIgnoreCacheDir, value);
				});
			});
	}
}
