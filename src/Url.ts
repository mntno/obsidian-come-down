

export class Url {

  /**
   * These are case-sensitive. Use {@link normalizedHeaders} to be safer.
   */
  public static readonly RESPONSE_HEADER = {
    contentType: "Content-Type",
    contentLength: "Content-Length",
    cacheControl: "Cache-Control",
    expires: "Expires",
  };

  public static readonly RESPONSE_HEADER_LOWERCASE = {
    contentType: Url.RESPONSE_HEADER.contentType.toLowerCase(),
    contentLength: Url.RESPONSE_HEADER.contentLength.toLowerCase(),
    cacheControl: Url.RESPONSE_HEADER.cacheControl.toLowerCase(),
    expires: Url.RESPONSE_HEADER.expires.toLowerCase(),
  };

  /**
   * Normalize headers to make sure to, e.g., find both `Content-Type` and `content-type`.
   */
  public static normalizeHeaders(headers: Record<string, string>): Record<string, string> {
    const normalizedHeaders: Record<string, string> = {};
    for (const key in headers)
      normalizedHeaders[key.toLowerCase()] = headers[key];
    return normalizedHeaders;
  }

   /**
   * @author Gemini   
   */
   public static isExternal(src: string): boolean {
    try {
      const url = new URL(src);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (error) {
      return false;
    }
  }

  /**
   * @author Gemini
   * @param url 
   * @returns 
   */
  public static extractFilenameAndExtension(url: string): { filename: string, extension: string} | null {
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

