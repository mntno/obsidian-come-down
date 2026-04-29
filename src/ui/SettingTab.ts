import { CacheManager } from "cache/CacheManager";
import { Env } from "Env";
import { Plugin, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import { Notice } from "ui/Notice";
import { SettingsManager, SettingsChanged } from "Settings";

export class SettingTab extends PluginSettingTab {
	private settingsManager: SettingsManager;
	private cacheManager: CacheManager;

	constructor(plugin: Plugin, settingsManager: SettingsManager, cacheManager: CacheManager) {
		super(plugin.app, plugin);
		Env.log.d("SettingTab:constructor");

		this.settingsManager = settingsManager;
		this.cacheManager = cacheManager;

		this.settingsManager.registerOnChangedCallback(this.onChangedCallback);
		plugin.register(() => {
			Env.log.d("SettingTab:constructor: unloading");
			this.settingsManager.unregisterOnChangedCallback(this.onChangedCallback);
		});
	}

	private onChangedCallback: SettingsChanged = () => {
		return this.update();
	};

	public override getControlValue(key: string): unknown {
		return (this.settingsManager.settings as unknown as Record<string, unknown>)[key];
	}

	public override async setControlValue(key: string, value: unknown): Promise<void> {
		Env.log.d("SettingTab:setControlValue");
		(this.settingsManager.settings as unknown as Record<string, unknown>)[key] = Env.str.is(value) ? value.trim() : value;
		await this.settingsManager.save();
		if (key === "noticeOnDownload")
			this.refreshDomState();
	}

	public override getSettingDefinitions(): SettingDefinitionItem[] {
		const settings = this.settingsManager.settings;

		return [
			{
				name: "Display a message on download",
				desc: "Let’s you know when files are downloaded and how many.",
				control: { type: "toggle", key: "noticeOnDownload" },
			},
			{
				name: "Use compact download message",
				desc: "Shortens the message to make it less distracting.",
				visible: () => settings.noticeOnDownload,
				control: { type: "toggle", key: "omitNameInNotice" },
			},
			{
				name: "Number of files cached",
				render: (setting) => this.renderCachedFilesSetting(setting),
			},
			{
				type: "group",
				heading: "Advanced",
				items: [
					// This is more of an "info setting" assuring that a .gitignore file exists rather than allowing its removal.
					{
						name: "Exclude cache from Git",
						desc: `Use a \`.gitignore\` file to prevent cached files from being visible to Git. Note that this option cannot be disabled here.`,
						render: (setting) => this.renderGitIgnoreSetting(setting),
					},
				],
			},
		];
	}

	private renderCachedFilesSetting(setting: Setting) {
		// 🤖
		// A documented use of the `render` callback's cleanup return ("May return a cleanup function, invoked before the row is torn down").
		// It prevents a *stale* `actualCachedFilePaths()` promise (still in flight after the row was re-rendered/detached) from writing `setDesc`/`addButton` into a dead element.
		// But: DOM writes to a detached node are harmless, and the re-rendered row gets its own fresh async call — so removing it causes no crash or visible bug.
		let disposed = false;
		this.cacheManager.actualCachedFilePaths().then((filePaths) => {
			if (disposed)
				return;

			const num = filePaths.length;
			setting.setDesc(`${num} file${num == 1 ? `` : `s`}.`);

			if (num == 0)
				return;

			setting.addButton((button) => {
				button.buttonEl.tabIndex = -1;
				button.setButtonText("Delete all cached files");
				button.onClick(() => {
					button.setButtonText("Confirm cache delete");
					button.setDestructive();
					button.onClick(async () => {

						await this.cacheManager.clearCached((error) => {
							if (error) {
								new Notice(`An error occured while clearing the cache: ${error.message}`, 0);
								Env.log.e("Error clearing cache.", error);
							}
							else {
								new Notice("Cache cleared");
								setting.setDesc("Cache is empty.")

								button.buttonEl.remove();

								Env.clearBrowserCache(() => new Notice("Electron cache cleared successfully. Restart vault."));
							}
						});
					});
				});
			});
		}).catch(error => {
			if (disposed)
				return;
			Env.log.e("Failed to count cached files:", error);
			setting.setDesc("Failed to count cached files.");
		});

		return () => { disposed = true; };
	}

	private renderGitIgnoreSetting(setting: Setting) {
		const settings = this.settingsManager.settings;
		setting.setClass("come-down-toggle-disabled");
		setting.addToggle((toggle) => {

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
				this.settingsManager.onChangedCallback(SettingsManager.SETTING_NAME.gitIgnoreCacheDir, value);
			});
		});
	}
}
