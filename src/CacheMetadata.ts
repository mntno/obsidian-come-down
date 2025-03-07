
/**
 * - All datetimes are stored in ISO 8601, e.g., "2023-10-27T10:30:00Z".
 */
export interface CacheMetadata {
  type: CacheType;
  file: CacheMetadataFile;
  hash: CacheMetadataHash;
  image?: CacheMetadataImage;
  retainer: { [key: string]: CacheRetainer };
  time: CacheMetadataTime;
}

export const enum CacheType {
  UNDEFINED = 0,
  IMAGE = 1,
};

export interface CacheMetadataFile {
  src: string;
  name: string;
  /** If empty string, then no extension. */
  ext: string;
  size: number;

  /**
   * Content-Type form HTTP header.
   */
  ct?: string;
}

export interface CacheMetadataHash {
  /** Which has to use as the key. Set to "keyMD5". */
  key: string;
  /** The hash that is used as a key to identify each cache item. The cached files and their metadata also have this as their filename. */
  keyMD5: string;
  cntMD5: string;
}

export function GetCacheKey(hash: CacheMetadataHash) {
  return hash[hash.key as keyof CacheMetadataHash];
}

export interface CacheMetadataImage {
  width: number;
  height: number;
  /** Type as parsed from image data by [image-size](https://github.com/image-size/image-size). If empty string, then not determined. */
  type: string;
}

/** 
 * All files that reference a {@link CacheMetadata}.
 * The cache should only be remove when there are no "retainers".
 */
export interface CacheRetainer {

}

export interface CacheMetadataTime {
  download: string;
  lastAccess: string;
}