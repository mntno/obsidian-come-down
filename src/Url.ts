

export class Url {

  /**
   * These are case-sensitive. Use with {@link normalizedHeaders}.
   */
  public static readonly RESPONSE_HEADER_LOWERCASE = {
    contentType: "Content-Type".toLowerCase(),
    contentLength: "Content-Length".toLowerCase(),
    cacheControl: "Cache-Control".toLowerCase(),
    expires: "Expires".toLowerCase(),
  } as const;

  public static readonly CACHE_CONTROL_LOWERCASE = {
    noStore: "no-store",
  } as const;

  /**
   * Normalize headers to make sure to, e.g., find both `Content-Type` and `content-type`.
   * Also ignores empty strings and trims.
   */
  public static normalizeHeaders(headers: Record<string, string>): Record<string, string> {
    const normalizedHeaders: Record<string, string> = {};

    for (const key in headers)
      if (key.length > 0)
        normalizedHeaders[key.toLowerCase().trim()] = headers[key];

    return normalizedHeaders;
  }

  public static isValid(url: string): boolean {
    return url && URL.canParse(url) ? true : false;
  }

  /**
   * These are not relevant: ftp, mailto, tel, ws: and wss:   
   */
  public static isExternal(src: string): boolean {
    try {
      const url = new URL(src);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (error) {
      return false;
    }
  }

  public static isEmbedded(url: string): boolean {
    return this.isBlob(url) || url.startsWith("data:");
  }

  public static isBlob(url: string): boolean {
    return url.startsWith("blob:"); // Note: no slashes
  }

  public static isLocal(url: string): boolean {
    // Slashes are better: e.g., "app:data" or "file:info" are not URLs.
    return url.startsWith("app://") || url.startsWith("capacitor://") || url.startsWith("file://");
  }

  /**
   * @author Gemini
   * @param url 
   * @returns 
   */
  public static extractFilenameAndExtension(url: string): { filename: string, extension: string } | null {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;

      if (!pathname) {
        return null; // No pathname, cannot extract filename
      }

      const filenameWithExtension = pathname.substring(pathname.lastIndexOf('/') + 1).split('?')[0]; // Remove query params

      if (!filenameWithExtension) {
        return null; // No filename found
      }

      const lastDotIndex = filenameWithExtension.lastIndexOf('.');

      if (lastDotIndex === -1) {
        return { filename: filenameWithExtension, extension: '' }; // No extension
      }

      const filename = filenameWithExtension.substring(0, lastDotIndex);
      const extension = filenameWithExtension.substring(lastDotIndex + 1);

      return { filename, extension };
    } catch (error) {
      console.error(`Error parsing URL: ${error}`);
      return null; // Invalid URL
    }
  }
}

