// types.ts - Global type declarations

// Global type aliases

export type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};

export interface FileInfo {
	filename: string;
	extension: string;
}
