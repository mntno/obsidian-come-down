
export const Arr = {
	firstOrNull: <T>(a: Array<T>): T | null => a.first() ?? null,
	orNull: <T>(v: T[] | T | null): T[] | null =>
		v === null
		? null
		: (Array.isArray(v) ? v : [v]),
} as const;

export const Err = {
	toError: (e: unknown): Error => e instanceof Error ? e : new Error(String(e)),
} as const;
