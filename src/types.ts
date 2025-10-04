// Global (see tsconfig `include`)
// Do not add `export`

type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};
