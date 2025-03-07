import { PluginSettingTab, Setting, Plugin } from "obsidian";

export interface PluginSettings {

	/** Shows a {@link Notice} when file download starts. */
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
}

export class SettingsManager {
	settings: PluginSettings;
	save: () => Promise<void>;
	onChangedCallback: (name: string) => void | undefined;

	static readonly DEFAULT_SETTINGS: PluginSettings = {
		noticeOnDownload: true,
		omitNameInNotice: false,
		gitIgnoreCacheDir: true,
	} as const;

	static readonly SETTING_NAME = {
		gitIgnoreCacheDir: "gitIgnoreCacheDir",
	} as const;

	constructor(settings: any, save: (settings: PluginSettings) => Promise<void>, onChangedCallback: (name: string) => void | undefined) {
		this.settings = settings;
		this.save = () => save(this.settings);
		this.onChangedCallback = onChangedCallback;
	}
}

export class SettingTab extends PluginSettingTab {
	settingsManager: SettingsManager;

	constructor(plugin: Plugin, settingsManager: SettingsManager) {
		super(plugin.app, plugin);
		this.settingsManager = settingsManager;
	}

	display(): void {
		const { containerEl } = this;
		const settings = this.settingsManager.settings;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Display a message on download")
			.setDesc("Let’s you know when files are downloaded and how many.")
			.addToggle((toggle) => {
				toggle.setValue(settings.noticeOnDownload);
				toggle.onChange(async (value) => {
					settings.noticeOnDownload = value;
					await this.settingsManager.save();
				});
			});

		new Setting(containerEl)
			.setName("Do not show pluign’s name in download message")
			.setDesc(`Toggle on to remove 'Come Down:' from the message.`)
			.addToggle((toggle) => {
				toggle.setValue(settings.omitNameInNotice);
				toggle.onChange(async (value) => {
					settings.omitNameInNotice = value;
					await this.settingsManager.save();
				});
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
					this.settingsManager?.onChangedCallback(SettingsManager.SETTING_NAME.gitIgnoreCacheDir);
				});
			})
	}
}