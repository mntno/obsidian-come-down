import { Env } from "../Env";
import { FileInfo } from "types";
import { Str } from "utils/ts";

declare const brand: unique symbol;
export type BlobUrl = string & { readonly [brand]: 'BlobUrl' };

export class Url {

	/**
		* These are case-sensitive. Use with {@link normalizedHeaders}.
		*/
	public static readonly RESPONSE_HEADER_LOWERCASE = {
		contentType: "Content-Type".toLowerCase(),
		contentLength: "Content-Length".toLowerCase(),
		cacheControl: "Cache-Control".toLowerCase(),
		expires: "Expires".toLowerCase(),
		etag: "ETag".toLowerCase(),
		lastModified: "Last-Modified".toLowerCase(),
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

		for (const key in headers) {
			const value = headers[key];
			if (key.length > 0 && value !== undefined) {
				normalizedHeaders[key.toLowerCase().trim()] = value;
			}
		}

		return normalizedHeaders;
	}

	/** @returns A trimmed {@link url} if {@link url} is a non-empty string. */
	public static normalizeUrl(url: string | null | undefined): string | null {
		return url?.trim() || null; // If left part evaluates to `undefined` or empty string, the expression `undefined || null` correctly evaluates to `null`.
	}

	/**
		* @param src
		* @param success
		* @returns `true` if {@link src} is a valid external url, in which case {@link success} will be invoked with the trimmed value; `false` if {@link src} is falsy, a blob, a local reference, etc.
		*/
	public static isValidExternalUrl(src: string | null | undefined, success?: (src: string) => void): boolean {
		if (Env.str.is(src)) {
			const trimmedSrc = src.trim();
			if (trimmedSrc.length > 0 && Url.isValid(trimmedSrc) && Url.isExternal(trimmedSrc)) {
				success?.(trimmedSrc);
				return true;
			}
		}
		return false;
	}

	public static isValid(url: string): boolean {
		return url && URL.canParse(url) ? true : false;
	}

	/** These are not relevant: ftp, mailto, tel, ws: and wss: */
	public static isExternal(src: string): boolean {
		try {
			const url = new URL(src);
			return url.protocol === "http:" || url.protocol === "https:";
		} catch {
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

	public static toBlobUrl(url: string): BlobUrl {
		Env.dev.assert(Env.dev.thunkedAssert(() => Url.isBlob(url)), Env.dev.thunkedStr(() =>`Expected a blob: URL, got: ${url}`));
		return url as BlobUrl;
	}

	/**
		* Parses an ETag header value into a storage-friendly format.
		* - `W/"abc"` -> `W/abc`
		* - `"abc"` -> `abc`
		* @param value The raw ETag header string.
		* @returns The tag value stripped of quotes, with "W/" prefix preserved if present.
		* @since 1.1.1
		*/
	public static parseETag(value: string | undefined): string | null {
		if (!Env.str.isNonEmpty(value))
			return null;

		const match = value.match(/^(W\/)?"(.*)"$/);
		if (match === null)
			return null;

		const prefix = match[1] !== undefined ? match[1] : Env.str.EMPTY;
		const tag = match[2];
		return `${prefix}${tag}`;
	}

	/**
		* Converts a stored ETag back to a format suitable for HTTP headers.
		* - `W/abc` -> `W/"abc"`
		* - `abc` -> `"abc"`
		* @param tag The stored ETag value.
		* @since 1.1.1
		*/
	public static stringifyETag(tag: string): string | null {
		if (Env.str.nonEmpty(tag) === undefined)
			return null;
		return tag.replace(/^(W\/)?(.*)$/, '$1"$2"');
	}

	public static trimBackslash(url: string): string {
		return url.endsWith("/") ? url.slice(0, -1) : url;
	}

	/**
		*
		* - All trailing dots are stripped from the filename, mirroring what Windows does with such names at the OS level.
		* - The returned values are otherwise faithful to the url, but are not sanitized for filesystem use: sinks must still validate before writing — `normalizePath` does not cover, e.g., Windows reserved device names ("con.png").
		*
		* @returns If no extension was found, an empty string is returned for the extension.
		*/
	public static extractFilenameAndExtension(url: string): FileInfo | null {
		try {
			const pathname = new URL(url).pathname;
			const segment = pathname.substring(pathname.lastIndexOf("/") + 1);

			let filenameWithExtension = segment;
			try {
				const decoded = decodeURIComponent(segment); // May throw on malformed % sequences
				if (!/[\p{Cc}\\/]/u.test(decoded) && !decoded.endsWith(Str.space)) // `\p{Cc}` matches control characters.
					filenameWithExtension = decoded;
			} catch {
				// Fall back to the raw, still-encoded segment.
			}

			filenameWithExtension = filenameWithExtension.replace(/\.+$/, Str.empty); // Windows strips all trailing dots; mirror that so names are portable.

			if (!Str.isNonEmpty(filenameWithExtension))
				return null; // Nothing left after stripping dots — no usable filename.

			const lastDotIndex = filenameWithExtension.lastIndexOf(".");

			if (lastDotIndex <= 0) // No extension.
				return { filename: filenameWithExtension, extension: Str.empty };

			return {
				filename: filenameWithExtension.substring(0, lastDotIndex),
				extension: filenameWithExtension.substring(lastDotIndex + 1),
			};

		} catch (error) {
			Env.log.d("Error parsing URL: ", error);
			return null; // Invalid URL
		}
	}
}
