import { App, Platform } from "obsidian";

const isProduction = process.env["NODE_ENV"] === "production";
const isDev = !isProduction;
const assertConsole: Pick<Console, "assert"> = console;

const noopLogger: Pick<Console, "debug" | "log" | "info" | "warn" | "error" | "assert"> = {
	debug: () => { },
	log: () => { },
	info: () => { },
	warn: () => { },
	error: () => { },
	assert: () => { },
};
const devLogger = isDev ? console : noopLogger;

/** Returns the dev logger when {@link enabled}, otherwise a no-op. */
const gate = (enabled: boolean) => enabled ? devLogger.info : noopLogger.info;

const _DevContext = {
	e: devLogger.error,
	assert: devLogger.assert,
	IS_DEV: isDev,
	runDev: isProduction ? () => { } : (action: () => void) => action(),

	/** @returns The result of evaluating {@link thunk} if {@link IS_DEV} is `true`. */
	thunkedStr: (thunk: () => string) => isDev ? thunk() : Env.str.EMPTY,

	thunkedAssert: (thunk: () => boolean) => isDev ? thunk() : true,

	logCategory: {
		CACHE_MANAGER: true,
		DEBUGGING: true,
		EDIT_UPDATE_PASS: true,
		POST_PROCESS_PASS: true,
	} as const,

	icon: {
		DEBUG: "🔍",
		CACHE_MANAGER: "📦",
		EDIT_UPDATE_PASS: "✏️",
		POST_PROCESS_PASS: "📖",
	} as const,
};
const DevContext: Readonly<typeof _DevContext> = _DevContext;

const _log = {
	d: devLogger.debug,
	l: devLogger.log,
	i: devLogger.info,
	w: console.warn,
	e: console.error,

	debug: gate(_DevContext.logCategory.DEBUGGING),
	edit: gate(_DevContext.logCategory.EDIT_UPDATE_PASS),
	read: gate(_DevContext.logCategory.POST_PROCESS_PASS),
	cm: gate(_DevContext.logCategory.CACHE_MANAGER),
};
const log: Readonly<typeof _log> = _log;

const _Env = {
	/** Debug/Dev context */
	dev: DevContext,
	isDev: DevContext.IS_DEV,

	/** Only for `null` or `undefined`, etc., checks. Used as a self-documenting check on that behavior. {@link DevContext.assert} */
	assert: assertConsole.assert,
	catch: console.error,

	log: log,

	perf: {
		now: (): DOMHighResTimeStamp => performance.now(),
		log: (text: string, timestamp: DOMHighResTimeStamp) => {
			const end = performance.now() - timestamp;
			devLogger.warn(`${text}: ${end} ms`);
		},
	},

	/**
		* @param appOrCallback - Either a callback function to execute after the cache is cleared, or an App instance to reload Obsidian.
		*/
	clearBrowserCache: (appOrCallback: (() => void) | App) => {
		if (isDev && Platform.isDesktopApp) {
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- `electron` is only available in the Obsidian desktop runtime, never as a bundled dependency
			const electron = require('electron') as { remote: { session: { defaultSession: { clearCache: () => Promise<void> } } } };
			electron.remote.session.defaultSession.clearCache()
				.then(() => {
					if (appOrCallback instanceof App) {
						(appOrCallback as unknown as { commands: { executeCommandById: (commandId: string) => void } }).commands.executeCommandById("app:reload");
					}
					else
						appOrCallback();
				})
				.catch((error: unknown) => console.error('Error clearing cache:', error));
		}
	},

	/** @returns `true` if running in the capacitor-js mobile app or if compiled for development with UI in mobile mode. */
	get isMobile() {
		if (Platform.isMobileApp)
			return true;
		if (isDev && Platform.isMobile)
			return true;
		return false;
	},

	obj: {
		is: (value: unknown): value is object => typeof value === "object" && value !== null, // `null` is an object
	} as const,

	str: {
		EMPTY: "",
		SPACE: " ",
		is: (value: unknown): value is string => typeof value === "string",
		nonEmpty: (value: unknown): string | undefined => typeof value === "string" && value !== "" ? value : undefined,
		isNonEmpty: (value: unknown): value is string => typeof value === "string" && value !== "",
	} as const,

	bool: {
		isTrue: (value: unknown): value is boolean => typeof value === "boolean" && value === true,
	} as const,
};
export const Env: Readonly<typeof _Env> = _Env;

export type LoggerFn = (...args: unknown[]) => void;
