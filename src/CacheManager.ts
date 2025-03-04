import { App } from "obsidian";

export interface CacheMetadataItem {
  /** Unique key to identify the cached item. */
  key: string;

  /** Path to the associated file. */
  filePath?: string;

  type: CacheResourceType;
}

export interface CacheItem {
  metadata: CacheMetadataItem;

  /** Path to the cached file. */
  filePath: string;
}

export interface CacheResult {
  item: CacheItem | undefined;

  /** Whether this `item` was fetched from the cache. */
  fromCache: boolean;

  error: Error | undefined;
}

export enum CacheResourceType {
  Undefined = 0,
  ExternalImage = 1,
}

export class CacheManager {
  private cache: { [key: string]: CacheItem } = {};
  private app: App;
  private cacheFolderPath: string;

  constructor(app: App, cacheFolderPath: string) {
    this.app = app;
    this.cacheFolderPath = cacheFolderPath;
  }

  async getCache(metadataItem: CacheMetadataItem, callback: (result: CacheResult) => any) {

    if (metadataItem.key.length == 0) {
      callback({ 
        item: undefined,
        fromCache: false,
        error: new Error(`The cache key is not set.`),
      });
      return;
    }

    if (!CacheManager.isExternalUrl(metadataItem.key)) {      
      callback({ 
        item: undefined,
        fromCache: false,
        error: new Error(`The cache key must be an external Url (${metadataItem.key})`),
      });
      return;
    }

    // TODO
    if (metadataItem.filePath) {
      const file = this.app.vault.getFileByPath(metadataItem.filePath);
      if (!file)
        return;
    }

    // Create a result from the cache, assuming it exists.
    let cacheResult: CacheResult = {
      item: this.cache[metadataItem.key],
      fromCache: true,
      error: undefined,
    }

    // Get it if it doesn't.
    if (!cacheResult.item) {
      await sleep(Math.floor(Math.random() * 101) + 1000);
      const cachedItem: CacheItem = {
        metadata: metadataItem,
        filePath: this.app.vault.adapter.getResourcePath(this.cacheFolderPath + "/image.png"),
      };
      this.cache[metadataItem.key] = cachedItem;
      cacheResult = { item: cachedItem, fromCache: false, error: undefined }
    }

    callback(cacheResult);
  }

  clearCached() {
    this.cache = {};
  }

  /**
   * Aborts current download requests for the specified file.
   * @todo
   */
  cancelOngoing(filePath: string) {

  }

  /**
  * Aborts all current download requests.
  * @todo
  */
  cancelAllOngoing() {

  }

  private static isExternalUrl(src: string): boolean {
    try {
      const url = new URL(src);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (error) {
      return false;
    }
  }
}