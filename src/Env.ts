import { App, Platform } from "obsidian";

const isProduction = process.env.NODE_ENV === "production";
const isDev = !isProduction;

const noopLogger = {
	debug: () => { },
	log: () => { },
	info: () => { },
	warn: () => { },
};

const devLogger = isDev ? console : noopLogger;

export const DevContext = {
	assert: isDev ? console.assert : () => { },
	IS_DEV: isDev,
	runDev: isProduction ? () => { } : (action: () => void) => action(),

	/** @returns The result of evaluating {@link thunk} if {@link IS_DEV} is `true`. */
	thunkedStr: (thunk: () => string) => isDev ? thunk() : "",

	logCategory: {
		CACHE_MANAGER: true,
		DEBUGGING: true,
		EDIT_UPDATE_PASS: true,
		POST_PROCESS_PASS: true,
		WORKAROUNDS: false,
	} as const,

	icon: {
		DEBUG: "🐞",
		CACHE_MANAGER: "📦",
		EDIT_UPDATE_PASS: "✏️",
		POST_PROCESS_PASS: "📖",
		WORKAROUND: "🔧",
	} as const,
} as const;

export const Env = {
	/** Debug/Dev context */
	dev: DevContext,
	isDev: DevContext.IS_DEV,

	/** Only for `null` or `undefined`, etc., checks. Used as a self-documenting check on that behavior. {@link DevContext#assert} */
	assert: console.assert,

	log: {
		noop: () => { },

		d: devLogger.debug,
		l: devLogger.log,
		i: devLogger.info,
		w: console.warn,
		e: console.error,

		debug: DevContext.logCategory.DEBUGGING ? devLogger.info : noopLogger.info,
		edit: DevContext.logCategory.EDIT_UPDATE_PASS ? devLogger.info : noopLogger.info,
		read: DevContext.logCategory.POST_PROCESS_PASS ? devLogger.info : noopLogger.info,
		cm: DevContext.logCategory.CACHE_MANAGER ? devLogger.info : noopLogger.info,
		workaround: DevContext.logCategory.WORKAROUNDS ? devLogger.info : noopLogger.info,
	},

	perf: {
		now: (): DOMHighResTimeStamp => performance.now(),
		log: (text: string, timestamp: DOMHighResTimeStamp) => {
			const end = performance.now() - timestamp;
			devLogger.warn(`${text}: ${end} ms`);
		},
	},

	clearBrowserCache: (appOrCallback: (() => void) | App) => {
		if (isDev && Platform.isDesktopApp) {
			require('electron').remote.session.defaultSession.clearCache()
				.then(() => {
					if (appOrCallback instanceof App) {
						// @ts-expect-error
						app.commands.executeCommandById("app:reload");
					}
					else
						appOrCallback();
				})
				.catch((error: any) => console.error('Error clearing cache:', error));
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

	str: {
		EMPTY: "",
		SPACE: " ",
		is: (value: unknown): value is string => typeof value === "string",
		nonEmpty: (value: unknown): string | undefined => typeof value === "string" && value !== "" ? value : undefined,
	} as const,

	bool: {
		isTrue: (value: unknown): value is boolean => typeof value === "boolean" && value === true,
	} as const,

} as const;

export type LoggerFn = (...args: unknown[]) => void;
