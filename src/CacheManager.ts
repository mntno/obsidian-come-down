import { imageSize } from "image-size";
import { normalizePath, requestUrl, Vault } from "obsidian";
import xxhash, { XXHashAPI } from "xxhash-wasm";
import { CacheMetadata, CacheMetadataImage, CacheRetainer, CacheRoot, CacheType, EMPTY_CACHE_ROOT } from "./CacheMetadata";
import { Env } from "./Env";
import { Url } from "./utils/Url";


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
				Env.log.e(`Domain name resolution error: ${info.sourceUrl} - ${error.message}`);
			} else if (error instanceof URIError) {
				Env.log.e("Invalid URL provided.");
			} else if (error.message && error.message.includes("net::ERR_INTERNET_DISCONNECTED")) {
				Env.log.e("Network error: Could not connect to the server.");
				this.isRetryable = true;
				this.isInternetDisconnected = true;
			} else {
				Env.log.e("Request failed:", error);
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

		Env.log.cm(Env.dev.icon.CACHE_MANAGER, "CacheManager:initCache");

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

	/**
		* A primary purpose of this method is to delete cached items whose retain count goes down to zero.
		*
		* Each time the retained caches are updated by a retainer, a diff is made with the previous
		* retained caches, which reveals references that were added and deleted.
		*
		* If a reference was deleted, the total retain count for that reference is checked, and if it's now 0,
		* it is marked for deletion.
		*
		* - Only cached/downloaded resources can be retained, i.e., the cache metadata must exist.
		* - Each retainer only retains the cache item once, even if used more than once.
		*
		* @param requests Multiple identical {@link CacheRequest} will be reduced to one. References to non-existent caches will be ignored.
		* @param retainerPath The path to the retainer (file). This is needed to know which retainer to release references, e.g., is {@link requests} is empty. Each {@link CacheRequest#requesterPath} of {@link requests} is expected to be equal to this.
		* @param options
		*/
	public async updateRetainedCaches(requests: CacheRequest[], retainerPath: string, options?: {
		/** These will not be touched, i.e., neither retained nor released. */
		requestsToIgnore?: Set<CacheRequest>;
		/** If `true` will remove any cache references on the associated {@link CacheRetainer|retainer}. */
		preventReleases?: boolean;
	}) {
		const { requestsToIgnore, preventReleases = false } = options || {};

		Env.log.cm(Env.dev.icon.CACHE_MANAGER, Env.dev.thunkedStr(() => `updateRetainedCaches: \n\t${requests.length} retain requests:\n\t\t${requests.map(r => r.source).join("\n\t\t")} \n\tRetainer: ${retainerPath}`));
		Env.dev.runDev(() => {
			requests.forEach(request => Env.assert(request.requesterPath === retainerPath, `Expected retainer of cache request (${request.source}) equal to ${retainerPath}`))
			Env.log.cm(`\tTo ignore count: ${requestsToIgnore ? requestsToIgnore.size : 0}, preventCacheRelases: ${preventReleases}`);
			Env.log.cm("\tCurrent retain count: ", this.retainCount());
		});

		// If retainer/file does not exist / is not yet registered, it will be.
		let retainer = this.metadataRoot.retainers[retainerPath];
		const cacheKeysCurrentlyReferenced = retainer ? [...retainer.ref] : [];

		// Populate set of keys to retain.
		// Make sure duplicates are removed and do not include cache keys that don't exist.
		const cacheKeysRequestedReferenced: string[] = [];
		for (const request of requests) {
			const cacheKey = CacheManager.createCacheKeyFromRequest(request);
			const cacheMetadata = this.cache[cacheKey];
			if (cacheMetadata !== undefined) {
				if (!cacheKeysRequestedReferenced.includes(cacheKey))
					cacheKeysRequestedReferenced.push(cacheKey);
			}
			else {
				Env.log.cm("\tCache key does not (yet) exist:", cacheKey);
			}
		}

		// These keys will be removed from the retain and release arrays below.
		const ignoredReferences = requestsToIgnore
			? [...requestsToIgnore].map(r => CacheManager.createCacheKeyFromRequest(r))
			: [];

		// New cache keys not previously referenced/retained by the retainer.
		const addedReferences = cacheKeysRequestedReferenced
			.filter(key => !cacheKeysCurrentlyReferenced.includes(key))
			.filter(key => !ignoredReferences.includes(key));

		// Cache keys previously referenced/retained by the retainer which will now be released.
		const removedReferences = preventReleases ? [] : cacheKeysCurrentlyReferenced
			.filter(key => !cacheKeysRequestedReferenced.includes(key))
			.filter(key => !ignoredReferences.includes(key));

		if (addedReferences.length == 0 && removedReferences.length == 0) {
			Env.log.cm(`\tNo change: all requested cache keys match the already referenced/retained keys. Aborting.`)
			return;
		}

		Env.log.cm("\tRequested cache keys:", cacheKeysRequestedReferenced);
		Env.log.cm("\tRetaining:", addedReferences);
		Env.log.cm("\tReleasing:", removedReferences);
		Env.log.cm("\tIgnoring:", ignoredReferences);

		let newRef = retainer !== undefined ? [...retainer.ref, ...addedReferences] : addedReferences;
		newRef = newRef.filter(r => !removedReferences.includes(r));
		this.setRetainerRefs(retainerPath, newRef);

		const updatedRetainCount = this.retainCount();
		Env.log.cm("\tUpdated retain count: ", updatedRetainCount);

		// Remove caches that are no longer referenced by any retainer.
		for (const removedReference of removedReferences) {
			if (!this.isRetained(updatedRetainCount, removedReference))
				await this.removeCacheItem(removedReference);
		}
	}

	/**
		* Overwrites {@link CacheRetainer#ref}.
		*
		* - Method is not concerned with reference counting.
		* - Call {@link saveMetadataIfDirty} to persist changes.
		*
		* @param retainerPath A new {@link CacheRetainer} will be created and assigned {@link ref} if non exists with this path.
		* @param ref May contain duplicates as they will be removed. If empty, {@link CacheRetainer} will be removed.
		*/
	public setRetainerRefs(retainerPath: string, ref: string[]) {

		// - Even though it's an array, a key should not appear twice (even if the associated physical cache is used more than once in the note).
		// - Do not reference non-existent keys.
		const uniqueAndExistingCacheKeys = [...new Set(ref)].filter(cacheKey => {
			const filter = Object.hasOwn(this.cache, cacheKey);
			Env.assert(filter, "Invalid reference to non-existent cache key ignored:", cacheKey);
			return filter;
		});

		Env.log.d("CacheManager:setRetainerRefs:", retainerPath, uniqueAndExistingCacheKeys);

		this.isMetadataDirty = true;

		let retainer = this.metadataRoot.retainers[retainerPath];
		if (retainer !== undefined) {
			retainer.ref = uniqueAndExistingCacheKeys;
		}
		else {
			// Create retainer
			retainer = { ref: uniqueAndExistingCacheKeys };
			this.metadataRoot.retainers[retainerPath] = retainer;
		}

		// As of now, this is the only property of a CacheRetainer so it can be cleaned up if property is empty.
		if (retainer.ref.length == 0)
			delete this.metadataRoot.retainers[retainerPath];
	}

	public renameRetainer(oldPath: string, path: string) {
		Env.log.cm(Env.dev.icon.CACHE_MANAGER, `CacheManager.renameRetainer\n\t${oldPath}`);

		let retainer = this.metadataRoot.retainers[oldPath];
		if (retainer !== undefined) {
			this.metadataRoot.retainers[path] = retainer;
			delete this.metadataRoot.retainers[oldPath];
			this.isMetadataDirty = true;
		}
		else {
			Env.log.cm("\tFailed: retainer not found.", oldPath);
		}
	}

	public async removeRetainer(path: string) {
		Env.log.cm(Env.dev.icon.CACHE_MANAGER, `CacheManager.removeRetainer\n\t${path}`);

		let retainer = this.metadataRoot.retainers[path];
		if (retainer === undefined) {
			// This can happen if a file which hasn't been open was deleted without opening it.
			Env.log.cm("\tFailed: No retainer found.");
			return;
		}

		try {
			// Make sure caches that become unreferenced when this retainer is removed are also removed.
			const retainCount = this.retainCount(retainer)
			for (const cacheKey of retainer.ref) {
				// Note: make sure to `if (count !== undefined)` rather than `if(count)` otherwise `count` will not be treated as a `number` and subtraction will fail.
				let count = retainCount[cacheKey];
				Env.assert(count !== undefined, cacheKey);

				if (count !== undefined) {
					count = count - 1;
					retainCount[cacheKey] = count;

					if (count == 0)
						await this.removeCacheItem(cacheKey);
				}
			}

			delete this.metadataRoot.retainers[path];
			this.isMetadataDirty = true;
		} catch (error) {
			Env.log.e(error);
		}
	}

	/**
		* If {@link cacheKey} is found in metadata, will removed the associated file from cache and from the metadata.
		*
		* {@link saveMetadataIfDirty} needs to be called at some point to persist the matadata.
		*
		* @param cacheKey
		*/
	private async removeCacheItem(cacheKey: string) {
		const metadata = this.cache[cacheKey];
		Env.assert(metadata !== undefined, `Attempted to remove cash item using a non-existing key.`);
		if (metadata !== undefined) {
			Env.log.cm(Env.dev.icon.CACHE_MANAGER, `removeCacheItem\n\tRemoving ${this.nameOfCachedFileFromMetadata(metadata, cacheKey)}`);
			await this.vault.adapter.remove(this.filePathToCachedFileFromMetadata(metadata, cacheKey));
			delete this.cache[cacheKey];
			this.isMetadataDirty = true;
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
			// Increase count for each reference found.
			for (const cacheKey of retainer.ref) {
				// Note: make sure to `if (count !== undefined)` rather than `if(count)` otherwise `count` will not be treated as a `number` and addition will fail.
				let count = retainCounts[cacheKey];
				Env.assert(count !== undefined, "Retainer is referencing a cache key that does not exist", cacheKey);
				if (count !== undefined)
					retainCounts[cacheKey] = count + 1;
			}
		}

		// Delete zero counts for consistency: keys that do not exist are not referenced. Showing zero counts is also confusing when log-debugging.
		for (const key in retainCounts) {
			if (retainCounts[key] === 0)
				delete retainCounts[key];
		}

		return retainCounts;
	}

	/**
		* @param retainCounts Result of calling {@link retainCount}.
		* @param key Cache key to check.
		* @returns `true` if the key is retained in {@link retainCounts}.
		*/
	private isRetained(retainCounts: Record<string, number>, key: string) {
		let count = retainCounts[key];
		return count === undefined || count === 0 ? false : true; // Since 1.0.6, retain counts of zero are actually not present in the dictionary anymore.
	}

	public async info(callback: (info: CacheInfo) => void) {
		Env.log.d("CacheManager:info");

		const cacheKeys = Object.keys(this.cache);

		// Actual files on disk
		const actualCachedFilePaths = await this.actualCachedFilePaths();
		//Env.log.d("\tPhysical files in cache folder:", actualCachedFilePaths);

		// There is a cache key but no file with the same name.
		const cacheKeysWithoutAssociatedFile = [];
		for (const cacheKey of cacheKeys) {
			const cacheKeyMetadata = this.cache[cacheKey];
			let found = false;
			for (const associatedFilePath of actualCachedFilePaths) {
				if (cacheKeyMetadata !== undefined && associatedFilePath === this.filePathToCachedFileFromMetadata(cacheKeyMetadata, cacheKey)) {
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
				const cacheKeyMetadata = this.cache[cacheKey];
				if (cacheKeyMetadata && actualFilePath === this.filePathToCachedFileFromMetadata(cacheKeyMetadata, cacheKey)) {
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
			if (!Array.isArray(retainer.ref) || retainer.ref.length === 0)
				retainersWithoutReferences.push(retainer);
		}

		// There are cache keys that aren't referenced by any retainer.
		// TODO: Files not marked as retainer
		const cacheKeysWithoutAnyRetainer: string[] = [];
		const retainCount = this.retainCount();

		for (const cacheKey of cacheKeys) {
			if (!this.isRetained(retainCount, cacheKey))
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
		//   Env.log.cm(Env.dev.icon.CACHE_MANAGER, `CacheManager:existingCachedItem: Aborting because cache is currently downloading.`)
		//   return null;
		// }

		const result = await this.existingCache(request);
		if (result.item) {
			Env.log.cm(Env.dev.icon.CACHE_MANAGER, `CacheManager:getCache\n\tGot cache for cacheKey: ${result.cacheKey}`);
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
				Env.log.e("Failed to read metadata. Clearing cache.", error);
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
		* Always saves. See {@link saveMetadataIfDirty} to only save is metadata is dirty.
		*
		* @throws {Error} If writing to the storage fails.
		*/
	private async saveMetadata() {
		Env.log.cm(Env.dev.icon.CACHE_MANAGER, `CacheManager:saveMetadata`)
		await this.vault.adapter.write(this.metadataFilePath, Env.isDev ? JSON.stringify(this.metadataRoot, null, 2) : JSON.stringify(this.metadataRoot));
		this.isMetadataDirty = false;
		await this.updateMetadataFileLastModified();
		this.invokeMetadataChangeListeners();
	}

	public saveMetadataIfDirty(): Promise<void> | null {
		Env.log.cm(Env.dev.icon.CACHE_MANAGER, `CacheManager:saveMetadataIfDirty ${this.isMetadataDirty}`);
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
	public async checkIfMetadataFileChangedExternally() {
		const current = await CacheManager.fileLastModified(this.vault, this.metadataFilePath);
		Env.log.d(Env.dev.thunkedStr(() => `CacheManager:onMetadataFileChangedExternally: Will refresh in-memory metadata: ${current !== null && current > this.metadataFileLastModified}`));
		if (current !== null && current > this.metadataFileLastModified) {
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
				Env.log.e("Error executing data changed callback:", error);
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

	public static createRequest(src: string, path: string): CacheRequest {
		const source = src.trim();
		const requesterPath = path.trim();
		Env.assert(source.length > 0 && requesterPath.length > 0);
		return { source, requesterPath } satisfies CacheRequest;
	}

	public static isRequestEqual(request: CacheRequest, otherRequest: CacheRequest) {
		return request.source === otherRequest.source && request.requesterPath === otherRequest.requesterPath;
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
			Env.log.cm(Env.dev.icon.CACHE_MANAGER, `CacheManager:download: Requesting ${cacheKey} ⬇️⬇️⬇️\n\t...${sourceUrl.slice(-50)}`);

			if (Env.isDev)
				await sleep(Math.floor(Math.random() * 1001) + 1000);

			const response = await requestUrl({ url: sourceUrl, method: 'GET', throw: false });
			const headers = Url.normalizeHeaders(response.headers);
			const contentType = headers[Url.RESPONSE_HEADER_LOWERCASE.contentType] ?? undefined;
			const cacheControl = headers[Url.RESPONSE_HEADER_LOWERCASE.cacheControl] ?? undefined;

			//Env.log.cm(Env.dev.icon.CACHE_MANAGER, `CacheManager:download: Got response:\n\tcacheID: ${cacheKey}\n\t${response.status}\n\tcontentType: ${contentType}`);

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
					if (Env.isDev)
						Env.log.e("Failed to remove cached file after write error:", removeError);
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
			} satisfies CacheMetadata;

			try {
				this.metadataRoot.items[cacheKey] = metadata
				await this.saveMetadata(); // Throws
				result = new CacheResult(request, cacheKey, this.createCacheItem(metadata, false), null, true);

				Env.log.cm(Env.dev.icon.CACHE_MANAGER, `CacheManager:download\n\tDownloaded and cached ${this.nameOfCachedFileFromMetadata(metadata, cacheKey)}`);
			} catch (error) {

				if (Env.isDev)
					Env.log.e("Failed to write cache metadata:", error);

				// File write failed. Rollback the cache and remove the potentially created file.
				delete this.cache[cacheKey];

				try {
					await this.vault.adapter.remove(cacheItemPath);
				} catch (removeError) {
					if (Env.isDev)
						Env.log.e("Failed to remove cached file after write error:", removeError);
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
