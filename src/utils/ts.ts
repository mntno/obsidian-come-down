
export const Arr = {
	firstOrNull: <T>(a: Array<T>): T | null => a.first() ?? null,
};

export const Err = {
	toError: (e: unknown): Error => e instanceof Error ? e : new Error(String(e)),
};

export const Obj = {
	/**
		* If {@link value} is `null`, `false` is returned even thoigh `null` is an object.
		*
		* @param value
		* @returns `true` if `typeof` for {@link value} returns `"object"` and {@link value} is not `null`.
		*/
	is: (value: unknown): value is object => {
		return typeof value === "object" && value !== null; // In JavaScript runtime, `null` is an object. In TypeScript, with `strictNullChecks`, it is not.
	},

	try: <T extends object>(value: unknown): T | null => Obj.is(value) ? value as T : null,
};

export const Str = {
	empty: "",
	space: " ",
	lf: "\n",
	tab: "\t",

	/**
		* Checks whether `value` is a string.
		* @param value The value to check.
		* @returns `true` if `value` is a string, otherwise `false`.
		*/
	is: (value: unknown): value is string => typeof value === "string",

	/**
		* Checks whether `value` is a non-empty string.
		* @param value The value to check.
		* @returns `true` if `value` is a string with at least one character, otherwise `false`.
		*/
	isNonEmpty: (value: unknown): value is string => typeof value === "string" && value !== Str.empty,
};
