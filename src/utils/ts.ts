
export const Arr = {
	firstOrNull: <T>(a: Array<T>): T | null => a.first() ?? null,
} as const;

export const Err = {
	toError: (e: unknown): Error => e instanceof Error ? e : new Error(String(e)),
} as const;
