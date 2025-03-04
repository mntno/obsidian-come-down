import { PluginSettingTab, Setting, Plugin } from "obsidian";

interface PluginSettings {
	/** `true` to make sure there's a .gitignore file in the cache directory; `false` to make sure otherwise. */
	gitIgnoreCacheDir: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
	gitIgnoreCacheDir: true,
}

export class SettingsManager {
	settings: PluginSettings;
	save: () => Promise<void>;

	constructor(settings: any, save: (settings: PluginSettings) => Promise<void>) {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, settings);
		this.save = () => save(this.settings);
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
			.setDesc("Enable to automatically add a .gitignore file to your Obsidian cache, preventing it from being committed to Git.")
			.addToggle((toggle) => {
				toggle.setValue(this.settingsManager.settings.gitIgnoreCacheDir);
				toggle.onChange(async (value) => {
					this.settingsManager.settings.gitIgnoreCacheDir = value;
					await this.settingsManager.save();
				});
			})
	}
}