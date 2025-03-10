import { PluginSettingTab, Setting, Plugin, Platform } from "obsidian";
import { ENV, Notice } from "Environment";
import { CacheManager } from "CacheManager";

export interface PluginSettings {

	/** Show a {@link Notice} when file download starts. */
	noticeOnDownload: boolean

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

export class SettingsManager {
	public settings: PluginSettings;
	public save: () => Promise<void>;
	public onChangedCallback: (name: string, value: any) => void | undefined;

	static readonly DEFAULT_SETTINGS: PluginSettings = {
		noticeOnDownload: true,
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
}

export class SettingTab extends PluginSettingTab {
	private settingsManager: SettingsManager;
	private cacheManager: CacheManager;

	constructor(plugin: Plugin, settingsManager: SettingsManager, cacheManager: CacheManager) {
		super(plugin.app, plugin);
		this.settingsManager = settingsManager;
		this.cacheManager = cacheManager;
	}

	display(): void {
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
		setTimeout(() => {
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
									console.error("Error clearing cache.", error);
								}
								else {
									new Notice("Cache cleared");
									cachedFilesSetting.setDesc("Cache is empty.")

									button.buttonEl.remove();

									if (ENV.dev && Platform.isDesktopApp) {
										require('electron').remote.session.defaultSession.clearCache()
											.then(() => new Notice('Electron Cache cleared successfully. Restart vault.'))
											.catch((error: any) => console.error('Error clearing cache:', error));
									}
								}
							});
						});
					});
				});

			})
		});

		new Setting(containerEl)
			.setName("Advanced").setHeading();

		new Setting(containerEl)
			.setName("Exclude cache from Git")
			.setDesc(`Use a \`.gitignore\` file to prevent cached files from being visible to Git. Note that this option cannot be disabled here.`)
			.addToggle((toggle) => {

				const refreshDisabled = () => {
					if (settings.gitIgnoreCacheDir) {
						toggle.setDisabled(true);
						toggle.toggleEl.style.opacity = "0.5";
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
			})
	}
}
