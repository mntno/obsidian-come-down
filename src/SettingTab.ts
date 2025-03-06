import { PluginSettingTab, Setting, Plugin } from "obsidian";

interface PluginSettings {
	/** `true` to make sure there's a .gitignore file in the cache directory; `false` to make sure otherwise. */
	gitIgnoreCacheDir: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
	gitIgnoreCacheDir: true,
} as const;

export const SETTING_NAME = {
	gitIgnoreCacheDir: "gitIgnoreCacheDir",
} as const;

export class SettingsManager {
	settings: PluginSettings;
	save: () => Promise<void>;
	onChangedCallback: (name: string) => void | undefined;

	constructor(settings: any, save: (settings: PluginSettings) => Promise<void>, onChangedCallback: (name: string) => void | undefined) {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, settings);
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

		containerEl.empty();

		new Setting(containerEl)
			.setName("Exclude cache from Git")
			.setDesc("If you are using Git to backup/sync your vault: toggle this on to automatically add a .gitignore file to the cache folder, which will prevent cached files from being committed to Git; disable to remove the file.")
			.addToggle((toggle) => {
				toggle.setValue(this.settingsManager.settings.gitIgnoreCacheDir);
				toggle.onChange(async (value) => {
					this.settingsManager.settings.gitIgnoreCacheDir = value;
					await this.settingsManager.save();
					this.settingsManager?.onChangedCallback(SETTING_NAME.gitIgnoreCacheDir);
				});
			})
	}
}