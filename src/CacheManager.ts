import { normalizePath, requestUrl, Vault } from "obsidian";
import { imageSize } from 'image-size'
import xxhash, { XXHashAPI } from "xxhash-wasm";
import { CacheRoot, CacheMetadata, CacheMetadataImage, CacheRetainer, CacheType, EMPTY_CACHE_ROOT } from "CacheMetadata";
import { ENV, Log } from "Environment";
import { Url } from "Url";


//#region

export interface CacheRequest {
	/**
	 * Unique key to identify the source of what is requested.
	 * For an external image file, this would be the url.
	 */
	source: string;

	/** @todo Can do without. However, this makes each {@link CacheRequest} unique per requester. */
	requesterPath: string;
}

export interface CacheItem {

	/** The absolute path to the item, which can vary per platform, e.g., `app://` on desktop but `capacitor://` on mobile. */
	resourcePath: string;

	metadata: CacheMetadata;

	/** Whether this `item` was fetched from the cache. */
	fromCache: boolean;
}

/**
 * What you get after having requested a file from the {@link CacheManager}.
 */
export class CacheResult {
	/**
	 * @param request
	 * @param cacheKey
	 * @param item
	 * @param error If {@link item} is set, this won't be.
	 * @param fileExists If `undefined`, it's unknown whether the file exists.
	 */
	constructor(
		public readonly request: CacheRequest,
		public readonly cacheKey: string,
		public readonly item: CacheItem | null,
		public readonly error: Error | null,
		public readonly fileExists?: boolean) { }
}

export class CacheError extends Error {
	constructor(public readonly cacheKey: string, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "CacheError";
	}
}

export class CacheTypeError extends CacheError {
	constructor(error: TypeError) {
		super("", error.message, { cause: error });
		this.name = "CacheTypeError";
	}
}

/**
 * In the event of a cache miss.
 */
export class CacheNotFoundError extends CacheError {
	/**
	 * @param cacheKey
	 */
	constructor(cacheKey: string, cause?: Error) {
		super(cacheKey, `Cache not found: ${cacheKey}`, { cause: cause });
		this.name = "CacheNotFoundError";
	}
}

export class CacheFetchError extends CacheError {
	public readonly isRetryable: boolean = false;
	public readonly isInternetDisconnected: boolean = false;

	constructor(cacheKey: string, readonly error: Error | null, readonly info: { readonly sourceUrl: string, readonly statusCode?: number }) {

		super(cacheKey, `Failed to fetch cache: ${cacheKey}. Status: ${info?.statusCode ?? "Unknown"}`, { cause: error });

		if (error) {
			if (error.message && error.message.includes("net::ERR_NAME_NOT_RESOLVED")) {
				Log(`Domain name resolution error: ${info.sourceUrl} - ${error.message}`);
			} else if (error instanceof URIError) {
				Log("Invalid URL provided.");
			} else if (error.message && error.message.includes("net::ERR_INTERNET_DISCONNECTED")) {
				Log("Network error: Could not connect to the server.");
				this.isRetryable = true;
				this.isInternetDisconnected = true;
			} else {
				Log("Request failed:", error);
			}
		}
		else {
			this.isRetryable = !this.info?.statusCode || (this.info?.statusCode >= 500 && this.info?.statusCode < 600);
		}
	}
}

export interface CacheInfo {
	summary: string;
	numberOfFilesCached: number;
	numberOfActualFilesWithoutAssociatedCacheKey: number;
	numberOfCacheKeysWithoutAssociatedFile: number;
}

interface FileInfo {
	filename: string;
	extension: string;
}

//#endregion

/** Use with {@link CacheManager.registerMetadataChanged} */
export type MetadataChanged = (data: CacheRoot) => void;

export class CacheManager {

	private metadataRoot: CacheRoot;

	private get cache(): Record<string, CacheMetadata> {
		return this.metadataRoot.items;
	};

	/** Ongoing downloads. As downloads complete, they will be removed. */
	private readonly currentDownloads: Map<string, CacheRequest> = new Map();
	private readonly vault: Vault;
	/** Root directory where cache is kept. Relative to vault root. */
	private readonly cacheDir: string;
	private readonly metadataFilePath: string;

	private static hasher: XXHashAPI;

	private readonly filePathsToOmitWhenClearingCache: string[]

	//#region

	private constructor(vault: Vault, cacheDir: string, metadataFilePath: string, filePathsToOmitWhenClearingCache: string[]) {
		this.vault = vault;
		this.cacheDir = cacheDir;
		this.metadataFilePath = metadataFilePath;
		this.filePathsToOmitWhenClearingCache = filePathsToOmitWhenClearingCache.includes(metadataFilePath) ? filePathsToOmitWhenClearingCache : [...filePathsToOmitWhenClearingCache, metadataFilePath];
	}

	public static async create(vault: Vault, cacheDir: string, metadataFilePath: string, filePathsToOmitWhenClearingCache: string[] = []) {
		const instance = new this(vault, cacheDir, metadataFilePath, filePathsToOmitWhenClearingCache);
		if (!this.hasher)
			this.hasher = await xxhash(); // Seems to be quick.

		await instance.initCache(); // This can be called lazily if it turns out reading the json file takes too long time.

		return instance;
	}

	/**
	 * Populates {@link cache} and {@link retainers} from JSON file.
	 */
	private async initCache() {
		if (this.cacheInitiated)
			return;

		if (this.initPromise)
			return this.initPromise; // If there's an ongoing initialization, wait for it to complete.

		Log(`CacheManager:initCache`);

		this.initPromise = (async () => {
			try {
				await this.loadMetadata();
				this.cacheInitiated = true;
			} catch (error) {
				throw error;
			} finally {
				this.initPromise = null; // Reset when done.
			}
		})();

		return this.initPromise;
	}
	private cacheInitiated = false;
	private initPromise: Promise<void> | null = null;

	//#endregion

	/**
	 * Call before making requests.
	 *
	 * @param request
	 * @returns
	 */
	public validateRequest(request: CacheRequest): Error | undefined {
		if (request.source.length == 0)
			return new Error(`The cache key is not set.`);

		if (!Url.isExternal(request.source))
			return new Error(`The cache key must be an external Url (${request.source})`);
	}

	//#region Retain/Release

	/**
	 * - Only cached/downloaded resources can be retained
	 * - Only if they are actually refrenced should they be retained.
	 * - Each retainer only retains the cache item once, even if used more than once.
	 *
	 * Each time the retained caches are updated by a retainer a diff is made with the previous
	 * retained caches, which reveals references that were added and deleted.
	 * If a reference was deleted, the total retain count for that reference is checked, and if it's now 0,
	 * it is marked for deletion.
	 *
	 * @param requests
	 * @returns
	 */
	public async updateRetainedCaches(requests: CacheRequest[], retainerPath: string) {

		Log(`CacheManager:retainRequests ${requests.length}\n\tRetainer: ${retainerPath}`);

		let retainer: CacheRetainer = this.metadataRoot.retainers[retainerPath];

		const oldCi = retainer ? [...retainer.ref] : [];
		const newCi: string[] = [];

		for (const request of requests) {
			const cacheKey = CacheManager.createCacheKeyFromRequest(request);
			if (!newCi.includes(cacheKey)) {
				newCi.push(cacheKey);
			}
		}

		const addedReferences = newCi.filter(key => !oldCi.includes(key));
		const removedReferences = oldCi.filter(key => !newCi.includes(key));

		if (addedReferences.length == 0 && removedReferences.length == 0) {
			Log(`\tNo change.`)
			return;
		}

		this.isMetadataDirty = true;

		// console.log(`Update: ` + newCi);
		// console.log(`Retaining: ` + addedReferences);
		// console.log(`Releasing: ` + removedReferences);

		if (retainer) {
			retainer.ref = newCi;
		}
		else {
			retainer = { ref: newCi }
			this.metadataRoot.retainers[retainerPath] = retainer;
		}

		const retainCount = this.retainCount();
		// console.log(this.retainCount());

		for (const removedReference of removedReferences) {
			const cacheKeyRetainCount = retainCount[removedReference];
			console.assert(cacheKeyRetainCount !== undefined, `Expected key ${removedReference} in retain count record.`);
			if (cacheKeyRetainCount === 0) {
				await this.removeCacheItem(removedReference);
			}
		}

		// If it doesn't refernce anything anymore there's no need to keep it around.
		if (retainer.ref.length == 0)
			delete this.metadataRoot.retainers[retainerPath];
	}

	public renameRetainer(oldPath: string, path: string) {
		Log(`CacheManager.renameRetainer\n\t${oldPath}`);

		let retainer: CacheRetainer = this.metadataRoot.retainers[oldPath];
		if (retainer) {
			this.metadataRoot.retainers[path] = retainer;
			delete this.metadataRoot.retainers[oldPath];
			this.isMetadataDirty = true;
		}
	}

	public async removeRetainer(path: string) {
		Log(`CacheManager.removeRetainer\n\t${path}`);

		let retainer: CacheRetainer = this.metadataRoot.retainers[path];
		if (!retainer) {
			// This can happen if a file which hasn't been open was deleted without opening it.
			return;
		}

		try {
			const retainCount = this.retainCount(retainer)
			for (const cacheKey of retainer.ref) {
				// Release
				retainCount[cacheKey]--;

				if (retainCount[cacheKey] == 0) {
					await this.removeCacheItem(cacheKey);
				}
			}

			delete this.metadataRoot.retainers[path];
			this.isMetadataDirty = true;
		} catch (error) {
			console.error(error);
		}
	}

	private async removeCacheItem(cacheKey: string) {
		const metadata = this.cache[cacheKey];
		console.assert(metadata !== undefined, `Attempted to remove cash item using a non-existing key.`);
		if (metadata !== undefined) {
			Log(`CacheManager:removeCacheItem\n\tRemoving ${this.nameOfCachedFileFromMetadata(metadata, cacheKey)}`);
			await this.vault.adapter.remove(this.filePathToCachedFileFromMetadata(metadata, cacheKey));
			delete this.cache[cacheKey];
		}
	}

	/**
	 * First registers all in-memory cache keys (if the {@link byRetainer} parameter is passed, only registers keys referenced by that retainer),
	 * then goes through all in-memory retainers and counts the number of total references
	 * for each registered cache key.
	 *
	 * @param byRetainer
	 * @returns A `Record` where the key is the cache key and the value its retain count.
	 */
	public retainCount(byRetainer?: CacheRetainer) {
		// Get retain counts on all caches used.
		const retainCounts: Record<string, number> = {};

		if (byRetainer) {
			for (const cacheKey of byRetainer.ref) {
				retainCounts[cacheKey] = 0;
			}
		}
		else {
			for (const cacheKey of Object.keys(this.cache)) {
				retainCounts[cacheKey] = 0;
			}
		}

		for (const retainer of Object.values(this.metadataRoot.retainers)) {
			for (const cacheKey of retainer.ref)
				if (cacheKey in retainCounts)
					retainCounts[cacheKey]++;
		}

		return retainCounts;
	}

	public async info(callback: (info: CacheInfo) => void) {

		const cacheKeys = Object.keys(this.cache);

		// Actual files on disk
		const actualCachedFilePaths = await this.actualCachedFilePaths();

		// There is a cache key but no file with the same name.
		const cacheKeysWithoutAssociatedFile = [];
		for (const cacheKey of cacheKeys) {
			const cacheKeyMetadata: CacheMetadata = this.cache[cacheKey];
			let found = false;
			for (const associatedFilePath of actualCachedFilePaths) {
				if (associatedFilePath === this.filePathToCachedFileFromMetadata(cacheKeyMetadata, cacheKey)) {
					found = true;
					break;
				}
			}
			if (!found)
				cacheKeysWithoutAssociatedFile.push(cacheKey);
		}

		// There is an actual file on disk but no corresponding cache key.
		const actualFileWithoutAssociatedCacheKey = [];
		for (const actualFilePath of actualCachedFilePaths) {
			let found = false;
			for (const cacheKey of cacheKeys) {
				const cacheKeyMetadata: CacheMetadata = this.cache[cacheKey];
				if (actualFilePath === this.filePathToCachedFileFromMetadata(cacheKeyMetadata, cacheKey)) {
					found = true;
					break;
				}
			}
			if (!found)
				actualFileWithoutAssociatedCacheKey.push(actualFilePath.split("/").pop());
		}

		//
		const retainers: CacheRetainer[] = Object.values(this.metadataRoot.retainers);
		const numberOfRetainers = retainers.length;

		// Here the Mardown file has been deleted but its still exists as a retainer.
		const retainersWithoutActualFile = [];
		for (const actualFilePath in this.metadataRoot.retainers) {
			if (!await this.vault.adapter.exists(actualFilePath))
				retainersWithoutActualFile.push(actualFilePath);
		}

		const retainersWithoutReferences = [];
		for (const retainer of retainers) {
			if (!retainer.ref || retainer.ref.length == 0)
				retainersWithoutReferences.push(retainer);
		}

		// There are cache keys that aren't referenced by any retainer.
		// TODO: Files not marked as retainer
		const cacheKeysWithoutAnyRetainer: string[] = [];
		const retainCount = this.retainCount();

		for (const cacheKey of cacheKeys) {
			if (cacheKey in retainCount) {
				if (retainCount[cacheKey] == 0) // If the retain count is zero there is no retainer referencing it.
					cacheKeysWithoutAnyRetainer.push(cacheKey);
			}
			else // If there's a cache key that's not found in the retain count record, it means that there's no retainer that references the cache key.
				cacheKeysWithoutAnyRetainer.push(cacheKey);
		}

		const numberOfCacheKeysWithoutAssociatedFile = cacheKeysWithoutAssociatedFile.length;
		const numberOfActualFileWithoutAssociatedCacheKey = actualFileWithoutAssociatedCacheKey.length;

		let summary = "";
		summary += `Cache items without file: ${numberOfCacheKeysWithoutAssociatedFile}${numberOfCacheKeysWithoutAssociatedFile > 0 ? " 🛑" : ""}${numberOfCacheKeysWithoutAssociatedFile > 0 ? `: ${cacheKeysWithoutAssociatedFile.join(", ")}` : ""}\n`;
		summary += `Files whithout cache items: ${numberOfActualFileWithoutAssociatedCacheKey}${numberOfActualFileWithoutAssociatedCacheKey > 0 ? " 🛑" : ""}${actualFileWithoutAssociatedCacheKey.length > 0 ? `: ${actualFileWithoutAssociatedCacheKey.join(", ")}` : ""}\n`;
		summary += `Cache items without retainer: ${cacheKeysWithoutAnyRetainer.length}${cacheKeysWithoutAnyRetainer.length > 0 ? " 🛑" : ""}${cacheKeysWithoutAnyRetainer.length > 0 ? `: ${cacheKeysWithoutAnyRetainer.join(", ")}` : ""}\n\n`;
		summary += `Retainers without references: ${retainersWithoutReferences.length}${retainersWithoutReferences.length > 0 ? " 🛑" : ""}\n`;
		summary += `Retainers without file: ${retainersWithoutActualFile.length}${retainersWithoutActualFile.length > 0 ? " 🛑" : ""}\n`;

		callback({
			summary: summary,
			numberOfFilesCached: actualCachedFilePaths.length,
			numberOfCacheKeysWithoutAssociatedFile: numberOfCacheKeysWithoutAssociatedFile,
			numberOfActualFilesWithoutAssociatedCacheKey: numberOfActualFileWithoutAssociatedCacheKey,
		});
	}

	//#endregion

	/**
	 * Get {@link CacheMetadata} if in cache.
	 * Will do nothing if the request doesn't exist in the cache.
	 * @param request
	 * @param [ignoreMissingFile=false] If set, will return the metadata without checking if the associated cache file actually exists.
	 * @returns Will also return `null` if the actual file does not exist.
	 */
	public async existingCache(request: CacheRequest, ignoreMissingFile: boolean = false, cacheKey?: string): Promise<CacheResult> {
		if (!this.cacheInitiated)
			await this.initCache()

		cacheKey = cacheKey ?? CacheManager.createCacheKeyFromRequest(request);
		const metadata = this.cache[cacheKey];
		if (metadata) {
			if (ignoreMissingFile || await this.vault.adapter.exists(this.filePathToCachedFileFromMetadata(metadata), true))
				return new CacheResult(request, cacheKey, this.createCacheItem(metadata, true), null, ignoreMissingFile ? undefined : true);
			else
				return new CacheResult(request, cacheKey, null, new CacheNotFoundError(cacheKey), false);
		}

		return new CacheResult(request, cacheKey, null, new CacheNotFoundError(cacheKey), undefined);
	}

	private createCacheItem(metadata: CacheMetadata, fromCache: boolean): CacheItem {
		return {
			resourcePath: this.vault.adapter.getResourcePath(this.filePathToCachedFileFromMetadata(metadata)),
			metadata: metadata,
			fromCache: fromCache
		};
	}

	/**
	 *
	 * @param request
	 * @param force Download immediately without checking if cache already exists.
	 * @param callback
	 * @returns
	 */
	public async getCache(request: CacheRequest, force: boolean, callback: (result: CacheResult) => void): Promise<void> {
		if (!this.cacheInitiated)
			await this.initCache();

		const validationError = this.validateRequest(request);
		if (validationError) {
			callback(new CacheResult(request, CacheManager.createCacheKeyFromRequest(request), null, validationError));
			return;
		}

		const download = async () => {
			const sourceFileInfo = Url.extractFilenameAndExtension(request.source) as FileInfo | null;
			if (!sourceFileInfo)
				callback(new CacheResult(request, CacheManager.createCacheKeyFromRequest(request), null, new Error(`Failed to extract fileInfo from source url.`)));
			else
				callback(await this.fetchNewCache(request, sourceFileInfo));
		};

		if (force) {
			await download();
			return;
		}

		// TODO: If assuming that, if the requested item is downloading, it doesn't exist on disk, then we could return null here. But can also proceed anyway.
		// if (this.cacheRequests.get(cacheID)) {
		//   Log(`CacheManager:existingCachedItem: Aborting because cache is currently downloading.`)
		//   return null;
		// }

		const result = await this.existingCache(request);
		if (result.item) {
			Log(`CacheManager:getCache\n\tGot cache for cacheKey: ${result.cacheKey}`);
			callback(result);
		}
		else {
			await download();
		}
	}

	/**
	 * When a {@link request} does not yield a local result, call this method to download.
	 *
	 * @param request
	 * @param sourceFileInfo
	 * @param callback
	 * @returns
	 */
	private async fetchNewCache(request: CacheRequest, sourceFileInfo: FileInfo): Promise<CacheResult> {
		let cacheKey: string | undefined;
		let result: CacheResult | undefined;

		try {
			cacheKey = CacheManager.createCacheKeyFromRequest(request);
			// TODO: Multiple Files Waiting Requesting the Same Cache
			this.currentDownloads.set(cacheKey, request);

			result = await this.download(request, sourceFileInfo);
		}
		catch (error) {
			result = new CacheResult(request, cacheKey ?? "", null, error);
		}
		finally {
			if (cacheKey)
				this.currentDownloads.delete(cacheKey);
		}

		return result;
	}

	/**
	 * Clears the entire cache.
	 *
	 * @param filePathsToOmit Array of normalized paths to files to not delete from disk.
	 */
	async clearCached(callback?: (error?: Error) => void) {
		try {
			await this.cancelAllOngoing();

			for (const filePath of await this.actualCachedFilePaths()) {
				if (!this.filePathsToOmitWhenClearingCache.includes(filePath))
					await this.vault.adapter.remove(filePath);
			}

			await this.resetMetadata();

			callback?.();
		} catch (error) {
			callback?.(error);
		}
	}

	public async actualCachedFilePaths() {
		const listed = await this.vault.adapter.list(this.cacheDir);
		return listed
			.files
			.filter((filePath) => !this.filePathsToOmitWhenClearingCache.includes(filePath))
	}

	public debug() {
		return {
			loadMetadata: async () => await this.loadMetadata(),
			saveMetadata: async () => await this.saveMetadata(),
		};
	}

	private async loadMetadata() {
		const metadataFileExists = await this.vault.adapter.exists(this.metadataFilePath, true);
		if (metadataFileExists) {
			const metadataFileContent: string = await this.vault.adapter.read(this.metadataFilePath);
			try {
				this.metadataRoot = Object.assign({}, EMPTY_CACHE_ROOT, JSON.parse(metadataFileContent));
				await this.updateMetadataFileLastModified();
			} catch (error) {
				console.error("Failed to read metadata. Clearing cache.", error);
				await this.clearCached();
			}
		}
		else {
			this.resetMetadata();
		}
	}

	/**
	 * Empties {@link metadataRoot} and its associated file at {@link metadataFilePath}.
	 * If they don't exist, they will be created.
	 */
	private async resetMetadata() {
		this.metadataRoot = Object.assign({}, EMPTY_CACHE_ROOT);
		await this.saveMetadata();
	}

	/**
	 * @throws {Error} If writing to the storage fails.
	*/
	private async saveMetadata() {
		Log(`CacheManager:saveMetadata`)
		await this.vault.adapter.write(this.metadataFilePath, ENV.dev ? JSON.stringify(this.metadataRoot, null, 2) : JSON.stringify(this.metadataRoot));
		this.isMetadataDirty = false;
		await this.updateMetadataFileLastModified();
		this.invokeMetadataChangeListeners();
	}

	public saveMetadataIfDirty(): Promise<void> | null {
		Log(`CacheManager:saveMetadataIfDirty ${this.isMetadataDirty}`);
		return this.isMetadataDirty ? this.saveMetadata() : null;
	}
	private isMetadataDirty: boolean = false;

	private async updateMetadataFileLastModified() {
		const mtime = await CacheManager.fileLastModified(this.vault, this.metadataFilePath);
		if (mtime)
			this.metadataFileLastModified = mtime;
	}

	/** Will be set to the modification time of the metadata file after reading and writing it. */
	private metadataFileLastModified: number = 0;

	/** @returns Time of last modification, represented as a unix timestamp, or `null` if failed. */
	private static async fileLastModified(vault: Vault, filePath: string) {
		const stat = await vault.adapter.stat(filePath);
		return stat ? stat.mtime : null;
	}

	/**
		* Should be called when the cache metadata file changed externally so that the in-memory copy is reloaded.
		* Does nothing if the file actually didn't change.
		*/
	public async onMetadataFileChangedExternally() {
		const current = await CacheManager.fileLastModified(this.vault, this.metadataFilePath);
		if (current && current > this.metadataFileLastModified) {
			await this.loadMetadata();
			this.invokeMetadataChangeListeners();
			return true;
		}
		return false;
	}

	private invokeMetadataChangeListeners() {
		this.registeredMetadataChangedCallbacks.forEach(callback => {
			try {
				callback(this.metadataRoot);
			}
			catch (error) {
				console.error("Error executing data changed callback:", error);
			}
		});
	}

	public registerMetadataChanged(cb: MetadataChanged) {
		if (!this.registeredMetadataChangedCallbacks.includes(cb))
			this.registeredMetadataChangedCallbacks.push(cb);
	}

	public unregisterMetadataChanged(cb: MetadataChanged) {
		this.registeredMetadataChangedCallbacks = this.registeredMetadataChangedCallbacks.filter(callback => callback !== cb);
	}
	private registeredMetadataChangedCallbacks: MetadataChanged[] = [];

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

	public static createCacheKeyFromOriginalSrc(src: string) {
		return this.hashString(src);
	}

	private static hashString(text: string) {
		return CacheManager.hasher.h64ToString(text.trim());
	}

	private static hashBinary(bytes: Uint8Array) {
		return CacheManager.hasher.h64Raw(bytes).toString(16).padStart(16, '0');
	}

	/**
	 * Generates a key from the {@link request}.
	 * @param request
	 * @returns
	 */
	private static createCacheKeyFromRequest(request: CacheRequest) {
		return CacheManager.createCacheKeyFromOriginalSrc(request.source)
	}

	public static createCacheKeyFromMetadata(metadata: CacheMetadata) {
		return CacheManager.createCacheKeyFromOriginalSrc(metadata.f.s);
	}

	// private filePathToAssociatedMetadata(request: CacheRequest) {
	//   return normalizePath(`${this.cacheDir}/${CacheManager.createCacheKey(request)}.json`);
	// }

	private filePathToCachedFile(request: CacheRequest, extension: string) {
		return normalizePath(`${this.cacheDir}/${CacheManager.createCacheKeyFromRequest(request)}${extension.length > 0 ? `.${extension}` : ``}`);
	}

	public filePathToCachedFileFromMetadata(metadata: CacheMetadata, cacheKey?: string) {
		return normalizePath(`${this.cacheDir}/${this.nameOfCachedFileFromMetadata(metadata, cacheKey)}`);
	}

	/**
	 *
	 * @param metadata
	 * @param cacheKey Supply the cache key if you have it to avoid generating it again.
	 * @returns
	 */
	private nameOfCachedFileFromMetadata(metadata: CacheMetadata, cacheKey?: string) {
		return `${cacheKey ?? CacheManager.createCacheKeyFromMetadata(metadata)}${metadata.f.e.length > 0 ? `.${metadata.f.e}` : ``}`;
	}

	private fileInfoFromMetadata(metadata: CacheMetadata): FileInfo {
		return { filename: metadata.f.n, extension: metadata.f.e };
	}

	/**
	 * 1. Downloads the {@link request}
	 * 2. Creates its {@link CacheMetadata|metadata}
	 * 3. Writes downloaded item to disk. Tries to roll back changes on failure.
	 *
	 * @param request
	 * @param fileInfo
	 * @returns
	 */
	private async download(request: CacheRequest, fileInfo: FileInfo): Promise<CacheResult> {

		let result: CacheResult;
		const sourceUrl = request.source;
		const cacheKey = CacheManager.createCacheKeyFromRequest(request);

		try {
			Log(`CacheManager:download: Requesting ${cacheKey} ⬇️⬇️⬇️\n\t...${sourceUrl.slice(-50)}`);

			if (ENV.dev)
				await sleep(Math.floor(Math.random() * 1001) + 1000);

			const response = await requestUrl({ url: sourceUrl, method: 'GET', throw: false });
			const headers = Url.normalizeHeaders(response.headers);
			const contentType = headers[Url.RESPONSE_HEADER_LOWERCASE.contentType] ?? undefined;
			const cacheControl = headers[Url.RESPONSE_HEADER_LOWERCASE.cacheControl] ?? undefined;

			//Log(`CacheManager:download: Got response:\n\tcacheID: ${cacheKey}\n\t${response.status}\n\tcontentType: ${contentType}`);

			if (cacheControl == Url.CACHE_CONTROL_LOWERCASE.noStore)
				throw new CacheError(`Caching not allowed on ${sourceUrl}.`, cacheKey);

			if (response.status >= 400)
				throw new CacheFetchError(cacheKey, null, { sourceUrl: sourceUrl, statusCode: response.status });

			const bytes = new Uint8Array(response.arrayBuffer);
			const imageMetadata = this.handleImage(bytes); // Will throw if what was downloaded isn't a supported image type. This is checked before the file is written.
			const nowDateString = new Date().toISOString();
			const cacheItemPath = this.filePathToCachedFile(request, fileInfo.extension);

			try {
				await this.vault.adapter.writeBinary(cacheItemPath, response.arrayBuffer);
			}
			catch (writeError) {
				try {
					await this.vault.adapter.remove(cacheItemPath);
				} catch (removeError) {
					if (ENV.debugLog)
						console.error("Failed to remove cached file after write error:", removeError);
				}
				throw writeError;
			}

			const metadata = {
				ty: CacheType.IMAGE,
				ti: {
					d: nowDateString,
					l: nowDateString,
					cc: cacheControl,
				},
				f: {
					s: sourceUrl,
					n: fileInfo.filename,
					e: fileInfo.extension,
					sz: response.arrayBuffer.byteLength,
					ct: contentType,
					ch: CacheManager.hashBinary(bytes),
				},
				i: imageMetadata
			};

			try {
				this.metadataRoot.items[cacheKey] = metadata
				await this.saveMetadata(); // Throws
				result = new CacheResult(request, cacheKey, this.createCacheItem(metadata, false), null, true);

				Log(`CacheManager:download\n\tDownloaded and cached ${this.nameOfCachedFileFromMetadata(metadata, cacheKey)}`);
			} catch (error) {

				if (ENV.debugLog)
					console.error("Failed to write cache metadata:", error);

				// File write failed. Rollback the cache and remove the potentially created file.
				delete this.cache[cacheKey];

				try {
					await this.vault.adapter.remove(cacheItemPath);
				} catch (removeError) {
					if (ENV.debugLog)
						console.error("Failed to remove cached file after write error:", removeError);
				}

				throw error;
			}
		} catch (error) {
			if (error instanceof CacheError)
				result = new CacheResult(request, cacheKey, null, error);
			else
				result = new CacheResult(request, cacheKey, null, new CacheFetchError(cacheKey, error, { sourceUrl: sourceUrl }));
		}

		return result;
	}

	/**
	 * Parses image metadata such as width and height.
	 *
	 * @param byteArray The image data as a `Uint8Array`.
	 * @returns The extracted image metadata.
	 * @throws {CacheTypeError} If the image type is unsupported.
	 * @throws {CacheError} If another error occurs while reading the image.
	 */
	private handleImage(byteArray: Uint8Array): CacheMetadataImage {

		try {
			const sizeCalcResult = imageSize(byteArray);

			// https://github.com/image-size/image-size#jpeg-image-orientation
			return {
				w: sizeCalcResult.width,
				h: sizeCalcResult.height,
				t: sizeCalcResult?.type ?? "",
			};
		} catch (error) {
			if (error instanceof TypeError)
				throw new CacheTypeError(error);
			else
				throw new CacheError("", "Failed to read image.", { cause: error });
		}
	}
}
