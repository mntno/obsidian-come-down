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

export type SettingsChanged = (settings: PluginSettings) => void;

export class SettingsManager {
	public settings: PluginSettings;
	public save: () => Promise<void>;
	public onChangedCallback: (name: string, value: unknown) => void | undefined;

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

	constructor(settings: PluginSettings, save: (settings: PluginSettings) => Promise<void>, onChangedCallback: (name: string, value: unknown) => void | undefined) {
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
