import { ENV, Log } from "Environment";
import { getIcon } from "obsidian";
import { Url } from "Url";

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

  public static isElementCacheStateEqual(element: HTMLElement, states: HTMLElementCacheState[]): boolean {
    return this.isCacheStateEqual(this.cacheState(element), states);
  }

  public static isCacheStateEqual(state: HTMLElementCacheState, states: HTMLElementCacheState[]): boolean {
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

    if (state === undefined)
      return HTMLElementCacheState.ORIGINAL;

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
     * - Will not do anything if: `src` attrib is missing or empty string; if the original src already has been set to the data set.
     * 
     * @param imageElements      
     */
  public static cancelImageLoading(imageElements: HTMLImageElement[]) {

    const cancelImageLoad = (imageElement: HTMLImageElement): boolean => {

      // Only continue if there's something to cancel.
      const src = imageElement.getAttribute(HTMLElementAttribute.SRC);
      if (!src) // Empty string is falsy.
        return false;

      if (ENV.debugLog && src && Url.isBlob(src)) {
        console.warn(`cancelImageLoading: Setting dataset to blob.`);
      }

      imageElement.dataset.comeDownOriginalSource = src;
      imageElement.removeAttribute(HTMLElementAttribute.SRC);
      HtmlAssistant.setCacheState(imageElement, HTMLElementCacheState.ORIGINAL_SRC_REMOVED);

      return true;
    };

    let counter = 0;
    imageElements.forEach((imageElement) => {
      if (cancelImageLoad(imageElement))
        counter++;
    });

    Log(`cancelImageLoading: Cancelled ${counter} of ${imageElements.length}.`);
  }

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

    /*
    switch (this.cacheState(element)) {
      case HTMLElementCacheState.ORIGINAL:
        return hasAttribute && element.src.trim().length > 0 ? element.src : null;
      case HTMLElementCacheState.INIT:
      case HTMLElementCacheState.CACHE_REQUEST:
      case HTMLElementCacheState.CACHE_SUCCESS:
      case HTMLElementCacheState.CACHE_FAILED: {

        const os = element.dataset.comeDownOriginalSource;
        if (os)
          return os;
        else if (hasAttribute) {
          return null;
        }
      }
    }   
    
    return null;*/
  }


  /**
  * This method is intended for finding unprocessed elements.
  * 
  * - 'img' selects all <img> elements.
  * - [src] selects only <img> elements that have a src attribute.
  * - :not([aria-hidden="true"]) filters out <img> elements that have the aria-hidden="true" attribute.
  *  
  * @param element 
  * @param requireSrcAttribute If `true` will not return image elements that don't have the `src` attribute.
  * @param filter 
  * @returns 
  */
  public static findRelevantImagesToProcess(element: HTMLElement, requireSrcAttribute: boolean = true, filter?: (imageElement: HTMLImageElement) => boolean): HTMLImageElement[] {
    let imageElements;
    if (requireSrcAttribute)
      imageElements = element.findAll('img[src]:not([aria-hidden="true"])') as HTMLImageElement[];
    else
      imageElements = element.findAll('img:not([aria-hidden="true"])') as HTMLImageElement[];

    return filter ? imageElements.filter((imageElement) => filter(imageElement)) : imageElements;

    /*       
      syntaxTree(view.state).iterate({			
        enter: ({ type, from, to }: SyntaxNodeRef) => {
          console.log(`${view.state.doc.sliceString(from, to)}`);
        }
      });
    */
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