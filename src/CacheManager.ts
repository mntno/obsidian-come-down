import { App, normalizePath, requestUrl, Vault } from "obsidian";
import { Md5 } from "ts-md5";
import { imageSize } from 'image-size'
import { ISizeCalculationResult } from "image-size/dist/types/interface";
import { CacheMetadata, CacheMetadataHash, CacheMetadataImage, CacheType, GetCacheKey } from "./CacheMetadata";
import { ENV, Log } from "./Environment";
import { Url } from "./Url";
//import { XXHash3 } from 'xxhash-addon';

//#region 

export interface CacheRequest {
  /** 
   * Unique key to identify the source of what is requested.
   * For an external image file, this would be the url.
   */
  key: string;
}

/**
 * Represents a cached file.
 */
export interface CacheItem {
  /** @deprecated Use CacheResult.request */
  request: CacheRequest;
  metadata: CacheMetadata;
  /** Path to the cached file. */
  filePath: string;
}

/**
 * What you get after having requested a file from the {@link CacheManager}.
 */
export interface CacheResult {
  request: CacheRequest;

  item?: CacheItem;

  /** Whether this `item` was fetched from the cache. */
  fromCache: boolean;

  /** If {@link item} is set, this won't be. */
  error?: Error;
}

function CacheResultFromError(error: Error, request: CacheRequest): CacheResult {
  return { request, error, fromCache: false };
}

function CacheResultFromCache(item: CacheItem, request: CacheRequest, fromCache: boolean = true): CacheResult {
  return { request, item, fromCache: fromCache };
}

interface FileInfo {
  filename: string;
  extension: string;
}

//#endregion

export class CacheManager {
  /**
   * The in-memory cache. Populated gradually as cache requests are made.
   */
  private cache: Record<string, CacheItem> = {};

  /** Ongoing downloads. As downloads complete, they will be removed. */
  private readonly currentDownloads: Map<string, CacheRequest> = new Map();
  private readonly vault: Vault;
  /** Root directory where cache is kept. Relative to vault root. */
  private readonly cacheDir: string;

  constructor(vault: Vault, cacheDir: string) {
    this.vault = vault;
    this.cacheDir = cacheDir;
  }

  /**
   * Call before making requests.
   * 
   * @param request 
   * @returns 
   */
  validateRequest(request: CacheRequest): Error | undefined {
    if (request.key.length == 0)
      return new Error(`The cache key is not set.`);

    if (!Url.isExternal(request.key))
      return new Error(`The cache key must be an external Url (${request.key})`);

    // if (!request.filePath || request.filePath.length == 0)
    //   return new Error(`Path to associated file not given.`);

    // const associatedFile = this.app.vault.getFileByPath(request.filePath);
    // if (!associatedFile)
    //   return new Error(`The file given does not exist: ${request.filePath}`);
  }

  /**
   * Returns immediately if the {@link CacheItem|cache} already exists in memory. If not, then — if all its referenced files also exist — it will be added to memory and returned.
   * 
   * - Call {@link validateRequest} first.
   * - This method is `async` because it does file I/O.
   * - {@link getCache} calls this method before downloading. If it's already known that the cache doesn't exist, let {@link getCache} know.
   * 
   * @param request
   * @param onMetadata Will be called if no {@link CacheItem} was retrieved, but its metadata was. Usually you'd get it from {@link CacheItem}.
   * @returns `null` if the requested {@link CacheItem} could not be retrieved.
   */
  public async existingCachedItem(request: CacheRequest, onMetadata?: (metadata: CacheMetadata) => Promise<void>): Promise<CacheItem | null> {

    const cacheID = CacheManager.createCacheKey(request);

    // If the cache exists in memory, it's assumed that the files exist as well (see below), so can return immediately.
    const inMemoryCache = this.cache[cacheID];
    if (inMemoryCache)
      return inMemoryCache;

    // Not in memory, get from drive.

    // TODO: If assuming that, if the requested item is downloading, it doesn't exist on disk, then we could return null here. But can also proceed anyway.
    // if (this.cacheRequests.get(cacheID)) {
    //   Log(`CacheManager:existingCachedItem: Aborting because cache is currently downloading.`)
    //   return null;
    // }

    // Even if a metadata file for the cache exists, also make sure the actual file exists. 
    // Once the in-memory cache has been updated subsequent calls to this method will not reach this part.
    // In cases when both files don't exist, however, subsequent calls to this method will continue to check for these files until the in-memory cache has been updated from having been downloaded.
    const metadataFileExists = await this.vault.adapter.exists(this.filePathToAssociatedMetadata(request), true);
    if (metadataFileExists) {

      const metadataFileContent: string = await this.vault.adapter.read(this.filePathToAssociatedMetadata(request));
      const metadata: CacheMetadata = JSON.parse(metadataFileContent);

      // Only set in-memory cache if the actual file exists.
      const cachedFileExists = await this.vault.adapter.exists(this.filePathToCachedFileFromMetadata(metadata), true);
      if (cachedFileExists) {
        // TODO: Multiple files waiting requesting the same cache.
        // this.cache[cacheID] = cacheResult.item might overwrite `CacheRequest.filePath`.

        console.assert(GetCacheKey(metadata.hash) === cacheID, `metadata.hash.keyMD5 !== cacheID`);
        Log(`CacheManager:existingCachedItem\n\tGot cached result from metadata file: ${metadata.hash.keyMD5}`);
        return this.setCache(request, metadata);
      }
      else {
        await onMetadata?.(metadata);
      }
    }
    else {
      Log(`CacheManager:existingCachedItem\n\tMetadata file for ${Url.extractFilenameAndExtension(request.key)?.filename} does not exist.`);
    }

    return null;
  }

  /**
   * 
   * @param request 
   * @param callback 
   * @param force Omit checking with {@link existingCachedItem} whether the cache already exists; download immediately. 
   * @returns 
   */
  public async getCache(request: CacheRequest, callback: (result: CacheResult) => void, force: boolean = false): Promise<void> {

    const validationError = this.validateRequest(request);
    if (validationError) {
      callback(CacheResultFromError(validationError, request));
      return;
    }

    const item = force ? null : await this.existingCachedItem(request, async (metadata) => {
      Log(`CacheManager:getCache\n\tMetadata exists but the actual file ${this.nameOfCachedFileFromMetadata(metadata)} doesn't. Download again.`)
      const sourceFileInfo: FileInfo = { filename: metadata.file.name, extension: metadata.file.ext };
      callback(await this.fetchNewCache(request, sourceFileInfo));
    });

    if (item) {
      callback(CacheResultFromCache(item, request));
    }
    else {
      const sourceFileInfo = Url.extractFilenameAndExtension(request.key) as FileInfo | null;
      if (!sourceFileInfo)
        callback(CacheResultFromError(new Error(`Failed to extract fileInfo from source url.`), request));
      else
        callback(await this.fetchNewCache(request, sourceFileInfo));
    }
  }

  /**
   * Creates a {@link CacheItem}, adds it to the in-memory cache, and then returns it.
   * @param request 
   * @param metadata 
   * @returns 
   */
  private setCache(request: CacheRequest, metadata: CacheMetadata): CacheItem {
    const cacheItem: CacheItem = {
      request: request,
      metadata: metadata,
      filePath: this.vault.adapter.getResourcePath(this.filePathToCachedFile(request, metadata.file.ext)),
    };
    this.cache[GetCacheKey(metadata.hash)] = cacheItem;

    return cacheItem;
  }

  /**
   * When a {@link request} does not yield a local result, call this, which will:
   * 
   * - call {@link download} to download and write files to storage.
   * - save the result to the in-memory {@link cache}
   * 
   * @param request 
   * @param sourceFileInfo 
   * @param callback 
   * @returns 
   */
  private async fetchNewCache(request: CacheRequest, sourceFileInfo: FileInfo): Promise<CacheResult> {
    let cacheID: string | undefined;
    let result: CacheResult | undefined;

    try {
      cacheID = CacheManager.createCacheKey(request);
      // TODO: Multiple Files Waiting Requesting the Same Cache
      this.currentDownloads.set(cacheID, request);

      const metadata: CacheMetadata | null = await this.download(request, sourceFileInfo);
      if (metadata) {
        Log(`CacheManager:fetchNewCache\n\tDownloaded and cached ${this.nameOfCachedFileFromMetadata(metadata)}`);
        result = CacheResultFromCache(this.setCache(request, metadata), request, false);
      }
      else {
        result = CacheResultFromError(new Error(`Failed to download file.`), request);
      }
    }
    catch (error) {
      result = CacheResultFromError(error, request);
    }
    finally {
      if (cacheID)
        this.currentDownloads.delete(cacheID);
    }

    return result;
  }

  /**
   * Clears the entire cache.
   * 
   * @param filePathsToOmit Array of normalized paths to files to not delete from disk.
   */
  async clearCached(filePathsToOmit: string[], callback?: (error?: Error) => void) {
    try {
      this.cache = {}; // Clear in-memory first in case something goes wrong below.
      await this.cancelAllOngoing();
      const listed = await this.vault.adapter.list(this.cacheDir);
      for (const filePath of listed.files) {
        if (!filePathsToOmit.includes(filePath))
          await this.vault.adapter.remove(filePath);
      }
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  /**
   * Aborts current download requests for the specified file.
   * @todo
   */
  async cancelOngoing(filePath: string) {
    await sleep(100);
  }

  /**
  * Aborts all current download requests. 
  * @todo
  */
  async cancelAllOngoing() {
    await sleep(100);
  }

  public static cacheKeyFromOriginalSrc(src: string) {
    return Md5.hashStr(src.trim());
  }

  /**
   * Generates a key from the {@link request}.
   * @param request 
   * @returns 
   */
  private static createCacheKey(request: CacheRequest) {
    return Md5.hashStr(request.key);
  }

  private filePathToAssociatedMetadata(request: CacheRequest) {
    return normalizePath(`${this.cacheDir}/${CacheManager.createCacheKey(request)}.json`);
  }

  private filePathToCachedFile(request: CacheRequest, extension: string) {
    return normalizePath(`${this.cacheDir}/${CacheManager.createCacheKey(request)}${extension.length > 0 ? `.${extension}` : ``}`);
  }

  private filePathToCachedFileFromMetadata(metadata: CacheMetadata) {
    return normalizePath(`${this.cacheDir}/${this.nameOfCachedFileFromMetadata(metadata)}`);
  }

  private nameOfCachedFileFromMetadata(metadata: CacheMetadata) {
    return `${GetCacheKey(metadata.hash)}${metadata.file.ext.length > 0 ? `.${metadata.file.ext}` : ``}`;
  }

  /**
   * 1. Downloads the {@link request}
   * 2. Creates its {@link CacheMetadata|metadata}
   * 3. Writes files to disk. Tries to roll back changes on failure.
   * 
   * @param request 
   * @param fileInfo 
   * @returns `null` if any 
   */
  private async download(request: CacheRequest, fileInfo: FileInfo): Promise<CacheMetadata | null> {

    let metadata: CacheMetadata | null = null;
    const sourceUrl = request.key;
    const cacheKey = CacheManager.createCacheKey(request);

    try {
      Log(`CacheManager:download: Requesting URL\n\t...${sourceUrl.slice(-50)}\n\tcacheID: ${cacheKey}`);

      const response = await requestUrl({ url: sourceUrl, method: 'GET', throw: true });
      const headers = Url.normalizeHeaders(response.headers);
      const contentType: string | undefined = headers[Url.RESPONSE_HEADER_LOWERCASE.contentType];

      if (ENV.dev)
        await sleep(Math.floor(Math.random() * 1001) + 2000);
      Log(`CacheManager:download: Got response:\n\tcacheID: ${cacheKey}\n\t${response.status}\n\tcontentType: ${contentType}`);

      if (!contentType) {
        Log(`\tNO CONTENT-TYPE\n\t${sourceUrl}`)
        console.log(response.headers);
      }

      const bytes = new Uint8Array(response.arrayBuffer);
      const nowDateString = new Date().toISOString();

      // Write file.
      try {
        await this.vault.adapter.writeBinary(this.filePathToCachedFile(request, fileInfo.extension), response.arrayBuffer);
      } catch (error) {
        throw error;
      }

      // Create metadata and write file.
      try {

        metadata = {
          type: CacheType.IMAGE,
          time: {
            download: nowDateString,
            lastAccess: nowDateString,
          },
          retainer: {
            //[`${request.filePath}`]: {} // TODO: Multiple Files Waiting Requesting the Same Cache
          },
          file: {
            src: sourceUrl,
            name: fileInfo.filename,
            ext: fileInfo.extension,
            size: response.arrayBuffer.byteLength,
            ct: contentType,
          },
          hash: {
            key: "keyMD5",
            keyMD5: cacheKey,
            cntMD5: CacheManager.HashMD5(bytes)
          },
          image: this.handleImage(bytes) ?? undefined
        };

        await this.vault.adapter.write(this.filePathToAssociatedMetadata(request), JSON.stringify(metadata, null, 2));
      } catch (error) {
        // The cache file was created but not its metadata. Reset and abort.
        metadata = null;
        await this.vault.adapter.remove(this.filePathToCachedFile(request, fileInfo.extension));
        throw error;
      }

    } catch (error) {
      console.error(`Error downloading and caching image: ${error}`);
    }

    return metadata;
  }

  private handleImage(byteArray: Uint8Array): CacheMetadataImage | null {

    let sizeCalcResult: ISizeCalculationResult | undefined;
    try {
      // trows if unsupported file type, or other error.
      sizeCalcResult = imageSize(byteArray);
    } catch (error) {
      console.error(`Unsupported image type: ${error.message}`);
    }

    // https://github.com/image-size/image-size#jpeg-image-orientation

    return sizeCalcResult ? {
      width: sizeCalcResult.width,
      height: sizeCalcResult.height,
      type: sizeCalcResult?.type ?? "",
    } : null;
  }

  private static HashMD5(array: Uint8Array) {
    //Log(`MD5`);
    return new Md5().appendByteArray(array).end() as string;
  }

  // https://www.npmjs.com/package/xxhash-addon
  // private static HashXXHash3(arrayBuffer: ArrayBuffer) {
  //   Log(`XXHash3`);
  //   return XXHash3.hash(Buffer.from(arrayBuffer)).toString('hex');
  // }
}
