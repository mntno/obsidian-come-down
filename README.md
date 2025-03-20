# Come Down

An [Obsidian](https://obsidian.md) plugin that downloads external images embedded in your notes, allowing them to be reused when you reopen the note. Once downloaded (cached), images will load if you’re offline or if you open a synced copy of your vault on another device. The plugin doesn’t modify your notes, so if you disable or uninstall it, everything will work as it did before.

## How to Use

Embed external images as you normally would using a Markdown link. Here’s an example from [Obsidian Help](https://help.obsidian.md/embeds#Embed+an+image+in+a+note):

```markdown
![250](https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Attachments/Engelbart.jpg)
```

When the plugin detects an external image URL, it takes over the downloading process. Once the image is saved, the plugin will automatically load it from the cached file instead of the original URL. The next time you open the note, the cached version will be used.

If your vault is synced through a file syncing solution like Syncthing or iCloud Drive (which treats your vault as a regular folder with files[^1]), cached images will sync across devices.

However, if your vault is backed up to or synced via Git (e.g., GitHub, GitLab), the cache won’t be included. This is intentional for two reasons: First, Git is designed for versioning plain-text files, not storing binary data like images. Second, hosting services like GitHub and GitLab are meant for managing code and text-based content, not for storing personal images like a photo service.

## Further Details

### Cache Location

Having the cache located inside the plugin’s folder serves several purposes:

- It keeps the cache hidden from view while browsing the vault.
- It ensures the cache syncs along with the rest of the vault if stored in iCloud Drive or another file-syncing service that syncs the entire vault.[^1]
- It allows the cache to be automatically deleted if the plugin is uninstalled.
- A .gitignore file can be placed in the cache folder to exclude it from Git. Had it been in a visible folder, users might mistakenly think that files they add there would be committed.

### Embedded Images Are Already Cached

Obsidian is built on Electron, which embeds the Chromium web browser. Therefore, it has built-in caching just as any web browser. But this cache exists outside your vault.

For example, if you copied your vault's root folder to a USB memory and opened it on another device, all embedded images would need to be downloaded again as each note is opened. Further, if that device were offline, they wouldn’t load at all.

### Disabling

If the plugin is disabled, everything will work as it did before the plugin was enabled — the embedded images will load by means of the underlying browser. Upon enabling it again, the plugin's already cached items will be used, bypassing the browser. 

Note that if an embedded image is removed from a note while the plugin is disabled, its potential cached file will not be removed until that specific note is opened again with the plugin enabled. If you want to disable the plugin you may delete the cache first from settings.

[^1]: This excludes [Obsidian Sync](https://obsidian.md/sync).











