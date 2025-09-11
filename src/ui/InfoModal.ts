import { App, ButtonComponent, Modal, Setting } from "obsidian";
import { CacheManager } from "../CacheManager";
import { PluginSettings } from "../Settings";
import { Notice } from "./Notice";
import { Env } from "../Env";

export class InfoModal extends Modal {
	private cacheManager: CacheManager;
	private settings: PluginSettings;

	constructor(app: App, cacheManager: CacheManager, settings: PluginSettings) {
		super(app);
		this.cacheManager = cacheManager;
		this.settings = settings;

		this.setTitle('Cacheboard');

		this.clearCacheSetting = new Setting(this.contentEl)
			.setName('Total number of files cached')
			.addButton((button) => {
				this.clearCacheButton = button;
				button.buttonEl.tabIndex = -1;
				button.setButtonText("Delete");
				button.onClick(() => {
					button.setButtonText("Confirm cache delete");
					button.setWarning();
					button.onClick(async () => {

						await cacheManager.clearCached((error) => {
							if (error) {
								new Notice(`An error occured while clearing the cache: ${error.message}`, 0);
								Env.log.e("Error clearing cache.", error);
							}
							else {
								new Notice("Cache cleared");

								button.buttonEl.remove();
								this.populate();
							}
						});
					});
				});
			});

		if (settings.showDebugInfo) {
			this.debugInfoSetting = new Setting(this.contentEl)
				.setName('Debug info')
				.addButton((button) => {
					button.setButtonText("Refresh metadata");
					button.onClick(async () => {
						await this.cacheManager.debug().loadMetadata();
						this.populate();
					});
				});
		}

		new Setting(this.contentEl)
			.addButton((button) => {
				this.closeButton = button;
				button.buttonEl.tabIndex = 1;
				button.setButtonText("Close");
				button.onClick(() => {
					this.close();
				});
			});
	}

	debugInfoSetting?: Setting;
	clearCacheSetting: Setting;
	clearCacheButton: ButtonComponent;
	closeButton: ButtonComponent;

	onOpen(): void {
		super.onOpen();
		this.cacheManager.registerMetadataChanged(this.onMetadataChangedCallback);
		setTimeout(() => {
			this.clearCacheButton.buttonEl.tabIndex = 0
			this.closeButton.buttonEl.focus();
		});

		this.populate();
	}

	onClose(): void {
		super.onClose();
		this.cacheManager.unregisterMetadataChanged(this.onMetadataChangedCallback);
	}

	private populate() {
		setTimeout(() => {

			this.debugInfoSetting?.descEl.empty();

			this.cacheManager.info((info) => {
				this.clearCacheSetting.setDesc(`${info.numberOfFilesCached} file${info.numberOfFilesCached == 1 ? `` : `s`}`);

				if (this.debugInfoSetting) {
					for (const line of info.summary.split("\n"))
						this.debugInfoSetting.descEl.createEl("div", {}, (p) => {
							p.innerText = line;
						})
				}
			});
		});
	}

	private onMetadataChangedCallback = () => this.populate();
}
