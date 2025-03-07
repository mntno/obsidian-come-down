import { ENV, Log } from "./Environment";

export const enum HTMLElementCacheState {
  /** Untouched by the plugin. */
  ORIGINAL = 0,
  /** The element has been seen. The original src/url has been removed. */
  ORIGINAL_CANCELLED,
  /** Waiting for cache. Note that the src attrib might be set to an SVG here. */
  CACHE_REQUESTED,
  CACHE_SUCCEEDED,
  /** Cache was requested but failed. Note that the src attrib might be set to an SVG here. */
  CACHE_FAILED,
}

export enum HTMLElementAttribute {
  SRC = "src",
  ALT = "alt",
}

export class HtmlAssistant {

  public static isCacheState(element: HTMLElement, state: HTMLElementCacheState): boolean {
    return this.cacheState(element) == state;
  }

  public static cacheState(element: HTMLElement): HTMLElementCacheState {
    const state = element.dataset.comeDownState;

    if (state === undefined)
      return HTMLElementCacheState.ORIGINAL;

    const numericState = Number(state);

    if (
      numericState !== HTMLElementCacheState.ORIGINAL &&
      numericState !== HTMLElementCacheState.ORIGINAL_CANCELLED &&
      numericState !== HTMLElementCacheState.CACHE_REQUESTED &&
      numericState !== HTMLElementCacheState.CACHE_SUCCEEDED &&
      numericState !== HTMLElementCacheState.CACHE_FAILED
    ) {
      throw new Error(`Invalid cache state: ${state}`);
    }

    return numericState as HTMLElementCacheState;
  }

  public static setCacheState(element: HTMLElement, state: HTMLElementCacheState) {
    element.dataset.comeDownState = state.toString();
  }

  public static setSuccess(element: HTMLElement, src: string) {
    HtmlAssistant.setCacheState(element, HTMLElementCacheState.CACHE_SUCCEEDED)
    if (element instanceof HTMLImageElement)
      element.setAttribute(HTMLElementAttribute.SRC, src);
  }

  public static setFailed(element: HTMLElement) {
    this.setCacheState(element, HTMLElementCacheState.CACHE_FAILED);
    if (element instanceof HTMLImageElement)
      this.setIcon(element, HtmlAssistant.ENCODED_FAILED_ICON);
  }

  /**
     * Removes the `src` attribute to prevent ordinary loading.
     * Use {@link imageElementOriginalSrc} to get it `src` when needed.
     * @param imageElements 
     * @returns The {@link imageElements} passed in for chaining.
     */
  public static preventImageLoading(imageElements: HTMLImageElement[]): HTMLImageElement[] {
    Log(`preventImageLoading: ${imageElements.length} image elements`);

    const preventOnImage = (imageElement: HTMLImageElement): boolean => {
      if (!imageElement.hasAttribute(HTMLElementAttribute.SRC))
        return false;

      // TODO: Setting src="" immediately results in its value set to `app://obsidian.md/index.html`		
      if (imageElement.dataset.comeDownOriginalSource) {
        Log(`\tAlready prevented. Skipping.`)
        return false;
      }

      const src = imageElement.src;

      if (src == "") {
        delete imageElement.dataset.comeDownOriginalSource;
        return false;
      }

      HtmlAssistant.setCacheState(imageElement, HTMLElementCacheState.ORIGINAL_CANCELLED); // TODO: Neeed? As dataset will be set at the same time
      imageElement.dataset.comeDownOriginalSource = src;

      // TODO: Setting src="" immediately results in its value set to `app://obsidian.md/index.html`		
      //imageElement.src = "";

      //Log(`\tRemoving src="...${imageElement.src.slice(-50)}"`);
      imageElement.removeAttribute(HTMLElementAttribute.SRC);

      return true;
    };

    imageElements.forEach((imageElement) => {
      //Log(`\tsrc: ${imageElement.src}, len:${imageElement.src.length}`);

      if (!preventOnImage(imageElement) && ENV.dev && imageElement.hasAttribute(HTMLElementAttribute.SRC))
        Log(`\tSrc: ${imageElement.src}, len:${imageElement.src.length}`);
    });

    return imageElements;
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
   * 1. Finds all image elements that are of interest
   * 2. Discards those already known.
   * 3. Calls {@link preventImageLoading} on the remaining.
   * 
   * @param element Element to start searching from.
   * @returns 
   */
  public static preparedImageElements(imageElements: HTMLImageElement[]): HTMLImageElement[] {
    if (imageElements.length == 0)
      return imageElements;

    Log(`preparedImageElements`);

    let processed = 0;
    let original = 0;

    const filtered = imageElements.filter((imageElement) => {
      switch (this.cacheState(imageElement)) {
        // These are new
        case HTMLElementCacheState.ORIGINAL: {
          //Log(`\tState ORIGINAL`);
          //Log(`\t\t${imageElement.outerHTML}`);
          original++;
          return true;
        }

        // These have passed this stage
        case HTMLElementCacheState.ORIGINAL_CANCELLED:
        case HTMLElementCacheState.CACHE_REQUESTED:
        case HTMLElementCacheState.CACHE_SUCCEEDED: {
          processed++;
          return false;
        }

        // What TODO:
        case HTMLElementCacheState.CACHE_FAILED:
          return false;

        default:
          throw new Error(`Unhandled cache state.`);
      }
    });

    Log(`\tTotal: ${imageElements.length}, original: ${original}, processed: ${processed}`);

    return filtered.length > 0 ? HtmlAssistant.preventImageLoading(filtered) : filtered;
  }

  /**
   *  
   * - 'img' selects all <img> elements.
   * - [src] selects only <img> elements that have a src attribute.
   * - :not([aria-hidden="true"]) filters out <img> elements that have the aria-hidden="true" attribute.
   * 
   * @param element Root element
   * @param requireSrcAttribute 
   * @returns  
   */
  public static findAllRelevantImages(element: HTMLElement, requireSrcAttribute: boolean = true): HTMLImageElement[] {
    if (requireSrcAttribute)
      return element.findAll('img[src]:not([aria-hidden="true"])') as HTMLImageElement[];
    else
      return element.findAll('img:not([aria-hidden="true"])') as HTMLImageElement[];

    /* 
      Gave up with this. Not sure if it's more efficient than view.contentDOM.findAll.
      syntaxTree(view.state).iterate({			
        enter: ({ type, from, to }: SyntaxNodeRef) => {
          console.log(`${view.state.doc.sliceString(from, to)}`);
        }
      });
    */
  }

  public static setIcon(imageElement: HTMLImageElement, engodedSvg: string) {
    imageElement.setAttribute(HTMLElementAttribute.SRC, `data:image/svg+xml;charset=utf-8,${engodedSvg}`);
  }

  /**
     * @todo
     * @see {@link https://lucide.dev/icons/loader}
     */
  private static readonly SVG_LOADING_ICON = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="transparant"
      stroke="currentColor"
      stroke-width="1"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M12 2v4" />
      <path d="m16.2 7.8 2.9-2.9" />
      <path d="M18 12h4" />
      <path d="m16.2 16.2 2.9 2.9" />
      <path d="M12 18v4" />
      <path d="m4.9 19.1 2.9-2.9" />
      <path d="M2 12h4" />
      <path d="m4.9 4.9 2.9 2.9" />
    </svg>
  `;

  private static readonly SVG_FAILED_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff0000" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-image"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`;

  static readonly ENCODED_LOADING_ICON = encodeURIComponent(this.SVG_LOADING_ICON);
  static readonly ENCODED_FAILED_ICON = encodeURIComponent(this.SVG_FAILED_ICON);
}