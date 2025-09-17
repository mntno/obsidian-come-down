import { getIcon } from "obsidian";
import { Env } from "./Env";
import { Url } from "./utils/Url";

export const enum HTMLElementCacheState {
	/** Untouched by the plugin. */
	ORIGINAL = 0,

	/**
		* The original src has been removed. Element is ready to request.
		*
		* A `data` attribute has been set on the element with the original src, get it with {@link HtmlAssistant.originalSrc}.
		*/
	ORIGINAL_SRC_REMOVED,

	/**
		* Requesting cache. If cache found, will be changed to {@link CACHE_SUCCEEDED}; if not, to {@link REQUESTING_DOWNLOADING}.
		*/
	REQUESTING,

	/**
		* Cache item was not found. Downloading.
		*/
	REQUESTING_DOWNLOADING,

	/**
		* The element's src is now pointing to the locally cached item, whether it was fetched from cache or downloaded.
		*/
	CACHE_SUCCEEDED,

	/**
		* Cache was requested but failed. As opposed to {@link INVALID}, these can be retried.
		* Basically equal to {@link ORIGINAL_SRC_REMOVED} except that they have requested at least once.
		*
		* For example, connection failed.
		*/
	CACHE_FAILED,

	/**
		* For example,
		* - the url doesn't exist (404)
		* - the url exists but is irrelevant, e.g., https://example.com/
		*
		* Elements in this state are ignored. The may or may not have an icon set ({@link HtmlAssistant.setIcon}), e.g., if the URL was requested but resulted in 404.
		*/
	INVALID,
}

export const enum HTMLElementAttribute {
	SRC = "src",
	ALT = "alt",
};

export class HtmlAssistant {

	public static isElementCacheStateEqual(element: HTMLElement, ...states: HTMLElementCacheState[]): boolean {
		return this.isCacheStateEqual(this.cacheState(element), ...states);
	}

	/** @returns `true` if one of the {@link states} is equal to {@link state}. */
	public static isCacheStateEqual(state: HTMLElementCacheState, ...states: HTMLElementCacheState[]): boolean {
		for (const stateToCheck of states)
			if (stateToCheck == state)
				return true;
		return false;
	}

	/**
		* @param element
		* @returns If {@link element} is lacking a state, {@link HTMLElementCacheState.ORIGINAL} is returned.
		*/
	public static cacheState(element: HTMLElement): HTMLElementCacheState {
		const state = element.dataset.comeDownState;

		if (state === undefined) {
			Env.log.d("HtmlAssistant:cacheState: No custom state `data-` attribute was found on the element. Returning", HTMLElementCacheState.ORIGINAL);
			return HTMLElementCacheState.ORIGINAL;
		}

		const numericState = Number(state);

		if (
			numericState !== HTMLElementCacheState.ORIGINAL &&
			numericState !== HTMLElementCacheState.ORIGINAL_SRC_REMOVED &&
			numericState !== HTMLElementCacheState.REQUESTING &&
			numericState !== HTMLElementCacheState.REQUESTING_DOWNLOADING &&
			numericState !== HTMLElementCacheState.CACHE_SUCCEEDED &&
			numericState !== HTMLElementCacheState.CACHE_FAILED &&
			numericState !== HTMLElementCacheState.INVALID
		) {
			throw new Error(`Invalid cache state: ${state}`);
		}

		return numericState as HTMLElementCacheState;
	}

	public static setCacheState(element: HTMLElement, state: HTMLElementCacheState) {
		Env.log.d("HtmlAssistant:setCacheState:", state);
		element.dataset.comeDownState = state.toString();
	}

	/**
		* Methods returns before the images have loaded but guarantees that they will load
		* unless the returned result's `error` is set.
		*
		* @param imageElements
		* @param src
		* @returns Assume file not found when an {@link Error} is returned, see {@link createBlobObjectUrl}.
		*/
	public static async loadImages(imageElements: HTMLImageElement[], src: string) {
		const result = await this.createBlobObjectUrl(src);

		if (result instanceof Error) {
			return {
				error: result,
				fileNotFound: result instanceof HtmlAssistantFileNotFoundError,
			};
		}
		else {
			let remainingLoads = imageElements.length;

			const onLoad = (event: Event) => {
				const img = event.target as HTMLImageElement;
				img.removeEventListener("load", onLoad);

				remainingLoads--;
				if (remainingLoads === 0) {
					URL.revokeObjectURL(result);
				}
			};

			for (const imageElement of imageElements) {
				imageElement.addEventListener("load", onLoad);
				imageElement.setAttribute(HTMLElementAttribute.SRC, result);
			}

			return null;
		}
	}

	/**
		* Removes all the data sets from the element.
		* @param element
		*/
	public static resetElement(element: HTMLElement) {
		delete element.dataset.comeDownOriginalSource;
		delete element.dataset.comeDownState;
	}

	public static setFailed(element: HTMLElement) {
		this.setCacheState(element, HTMLElementCacheState.CACHE_FAILED);
		if (element instanceof HTMLImageElement)
			this.setIcon(element, this.failedIcon);
	}

	public static setInvalid(element: HTMLElement) {
		this.setCacheState(element, HTMLElementCacheState.INVALID);
		if (element instanceof HTMLImageElement)
			this.setIcon(element, this.failedIcon);
	}

	/**
		* - Removes the `src` attribute to prevent ordinary loading.
		* - Sets the state to {@link HTMLElementCacheState.ORIGINAL_SRC_REMOVED}.
		* - Will not do anything if:
		*   - `src` attrib is missing or empty string; if
		*   - {@link imageElements} is empty.
		*
		* @param imageElements
		*/
	public static cancelImageLoading(imageElements: HTMLImageElement[]) {
		Env.log.d("HtmlAssistant:cancelImageLoading: Number of images:", imageElements.length);
		if (imageElements.length === 0)
			return;

		const cancelImageLoad = (imageElement: HTMLImageElement): boolean => {

			// Only continue if there's something to cancel.
			const src = this.getSrc(imageElement);
			if (src === null)
				return false;

			if (Env.isDev && src && Url.isBlob(src)) {
				console.warn(`cancelImageLoading: Setting dataset to blob.`);
			}

			HtmlAssistant.setOriginalSrc(imageElement, src);
			imageElement.removeAttribute(HTMLElementAttribute.SRC);
			HtmlAssistant.setCacheState(imageElement, HTMLElementCacheState.ORIGINAL_SRC_REMOVED);

			return true;
		};

		let counter = 0;
		imageElements.forEach((imageElement) => {
			if (cancelImageLoad(imageElement))
				counter++;
		});

		Env.log.d(`\tCancelled ${counter} of ${imageElements.length}.`);
	}

	/** @returns The trimmed `src` attribute, or `null` if it's missing or empty. */
	public static getSrc(element: HTMLImageElement): string | null {
		return element.getAttribute(HTMLElementAttribute.SRC)?.trim() || null; // If left part evaluates to `undefined` (or empty string), the expression `undefined || null` correctly evaluates to `null`.
	}

	private static setOriginalSrc(element: HTMLImageElement, src: string) {
		Env.assert(Env.str.is(src) && src.length > 0, "Must be a non-empty string");
		element.dataset.comeDownOriginalSource = src.trim();
	}

	/** @returns If {@link setOriginalSrc} was used at assignment, the value returned here is a trimmed, non-empty string; or `null` if no original source exists on the element. */
	public static originalSrc(element: HTMLImageElement) {
		return element.dataset.comeDownOriginalSource ?? null;
	}

	/**
		* Based on what's available in the HTML, returns image element's actual original source.
		* @returns The src or `null` if not available.
		*/
	public static imageElementOriginalSrc(element: HTMLImageElement): string | null {

		const os = element.dataset.comeDownOriginalSource;
		if (os)
			return os;

		const hasAttribute = element.hasAttribute(HTMLElementAttribute.SRC);
		return hasAttribute && element.src.trim().length > 0 ? element.src : null;
	}

	/**
		* - 'img' selects all <img> elements.
		* - [src] selects only <img> elements that have a src attribute.
		* - :not([aria-hidden="true"]) filters out <img> elements that have the aria-hidden="true" attribute.
		*
		* @param element Search children of this element.
		* @param requireSrcAttribute If `true` will not return image elements that don't have the `src` attribute.
		* @param filter
		* @returns
		*/
	public static findAllImageElements(element: HTMLElement, requireSrcAttribute: boolean = true, filter?: (imageElement: HTMLImageElement) => boolean): HTMLImageElement[] {
		let imageElements;
		if (requireSrcAttribute)
			imageElements = element.findAll('img[src]:not([aria-hidden="true"])') as HTMLImageElement[];
		else
			imageElements = element.findAll('img:not([aria-hidden="true"])') as HTMLImageElement[];

		return filter ? imageElements.filter((imageElement) => filter(imageElement)) : imageElements;
	}

	/**
		*
		* @see {@link https://developer.mozilla.org/en-US/docs/Web/API/File_API/Using_files_from_web_applications#using_object_urls|Using object URLs}
		*
		* @remarks
		*
		* If {@link src} points to a local file that doesn't exist, the Dev Tools will show "net::ERR_FILE_NOT_FOUND".
		* The net::ERR_FILE_NOT_FOUND message you see in the console comes from the browser’s internal networking layer, only shown in DevTools, not available to JavaScript code.
		* However, in Electron and Chrome-based browsers, fetch() throwing a TypeError generally means the file doesn’t exist.
		*
		* Capacitor also, which runs on the native mobile webview, also throws a `TypeError` on iOS (not tested on Android).
		*
		* To be safe, assume all `Error`s is file not found.
		*
		* @param src Url to a local resource. Would start with `app://`, `capacitor://`, or perhaps `file://`
		* @returns On failure, a {@link HtmlAssistantFileNotFoundError} if it thinks the a give local file doesn't exist; otherwise a normal Error.
	 */
	public static async createBlobObjectUrl(src: string): Promise<string | Error> {
		let response;

		try {
			// Response from `requestUrl` does not allow for creating blobs. These will always be local urls, so no need to handle CORS.
			response = await fetch(src);
		} catch (error) {
			if (error instanceof TypeError)
				return new HtmlAssistantFileNotFoundError(src);
			else
				return error;
		}

		if (response.ok) {
			try {
				const blob = await response.blob()
				const url = URL.createObjectURL(blob);
				if (url && URL.canParse(url) && Url.isBlob("blob:"))
					return url;
				else
					return new Error(`Invalid blob URL: ${url}`);
			} catch (error) {
				return error;
			}
		}
		else {
			return new Error(`Unsuccessful response: ${response.status} ${response.statusText}`);
		}
	}

	public static setLoadingIcon(imageElement: HTMLImageElement) {
		this.setIcon(imageElement, this.loadingIcon);
	}

	private static setIcon(imageElement: HTMLImageElement, blob: Blob) {
		const url = URL.createObjectURL(blob);
		const onLoad = (_event: Event) => {
			imageElement.removeEventListener("load", onLoad);
			URL.revokeObjectURL(url);
		}
		imageElement.addEventListener("load", onLoad);
		imageElement.setAttribute(HTMLElementAttribute.SRC, url);
	}

	/**
		* @see {@link https://lucide.dev/icons/loader}
		*/
	private static get loadingIcon(): Blob {
		if (this.loadingIconBacking === undefined) {
			const icon = getIcon("loader")
			console.assert(icon, "loader icon id not found");
			icon!.setAttribute("stroke", "#919191");
			icon!.setAttribute("stroke-width", "1");
			this.loadingIconBacking = new Blob([icon!.outerHTML], { type: "image/svg+xml" });
		}
		return this.loadingIconBacking;
	}
	private static loadingIconBacking?: Blob;

	private static get failedIcon(): Blob {
		if (this.failedIconBacking === undefined) {
			const icon = getIcon("image")
			console.assert(icon, "image icon id not found");
			icon!.setAttribute("stroke", "#ff0000");
			icon!.setAttribute("stroke-width", "1");
			this.failedIconBacking = new Blob([icon!.outerHTML], { type: "image/svg+xml" });
		}
		return this.failedIconBacking;
	}
	private static failedIconBacking?: Blob;
}

class HtmlAssistantFileNotFoundError extends Error {
	constructor(url: string) {
		super(`File not found: ${url}`);
		this.name = "HtmlAssistantFileNotFoundError";
	}
}
