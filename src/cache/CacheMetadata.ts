export interface CacheRoot {
  retainers: Record<string, CacheRetainer>;
  items: Record<string, CacheMetadata>;
}

export const EMPTY_CACHE_ROOT: CacheRoot = {
	retainers: {},
  items: {},
}

/**
 * All files that reference a {@link CacheMetadata}.
 * The cache should only be remove when there are no "retainers".
 */
export interface CacheRetainer {
  /** Cache items referenced, i.e., retained. */
  ref: string[];
}

/**
 * - All datetimes are stored in ISO 8601, e.g., "2023-10-27T10:30:00Z".
 */
export interface CacheMetadata {
  ty: CacheType;

  f: CacheMetadataFile;

  i?: CacheMetadataImage;

  ti: CacheMetadataTime;
}

export const enum CacheType {
  UNDEFINED = 0,
  IMAGE = 1,
};

/** Common things about a file and its content. */
export interface CacheMetadataFile {
  /** src */
  s: string;

  /** name */
  n: string;

  /**
   * ext
   * If empty string, then no extension.
   */
  e: string;

  /** size in bytes */
  sz: number;

  /**
   * Content-Type from the HTTP response header.
   */
  ct?: string;

  /** xxHash of the file's content. */
  ch: string;
}

/** Image specific */
export interface CacheMetadataImage {
  w: number;
  h: number;
  /** Type as parsed from image data by [image-size](https://github.com/image-size/image-size). If empty string, then not determined. */
  t: string;
}

/** Time related */
export interface CacheMetadataTime {

  /** Download time */
  d: string;

  /**
		* "Last time checked".
		*
		* Currently set to download time and never updated.
		* @todo May be used to keep track of when the server was last checked for modified.
		*/
  l: string;

  /** Value of the `Cache-Control` HTTP response header. */
  cc?: string;

  /**
		* Value of the `ETag` HTTP response header.
		*
		* In the HTTP spec (RFC 7232), an ETag must be wrapped in double quotes. But here they are not. Add them back when using the ETag in requests.
		*
		* @since 1.1.1
		*/
  et?: string;

	/**
		* Normalized value of the `Last-Modified` HTTP response header (ISO 8601).
		*
		* Converted from HTTP-date format to ISO for consistency. Convert back to UTC string when using in 'If-Modified-Since' headers.
		*
		* @since 1.1.1
		*/
  m?: string;
}
