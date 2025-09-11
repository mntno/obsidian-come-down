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
		EDIT_UPDATE_PASS: true,
		POST_PROCESS_PASS: true,
		WORKAROUNDS: false,
	} as const,

	icon: {
		NONE: "  ",
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

		/** To provide very granular, low-level, and highly detailed information. These logs are often too numerous to be helpful during general development but are invaluable when you're trying to diagnose a specific, complex bug. */
		d: devLogger.debug,

		/**
			* - This is the most general-purpose logging method. It's a good default when a message doesn't neatly fit into the error, warn, or info categories, or when you're just doing quick, ad-hoc debugging.
			* - When you use `console.log()`, you are typically saying: "Just output this general message." It's more of a catch-all, or often used for quick, ad-hoc debugging prints.
			*/
		l: devLogger.log,

		/**
			* - To provide high-level, general information about the application's flow or significant events. These are like "milestones" that give you an overview of what the application is doing.
			* - This is an informational message about a significant event or the general flow of the application. It implies a higher level of importance or a more structured type of message than a generic `log`.
			*/
		i: devLogger.info,

		/** To indicate a potential issue, a suboptimal practice, a deprecated feature being used, or a situation that might lead to an error later but isn't critical right now. It's a "heads up" or a "soft error." */
		w: devLogger.warn,

		/** Always logs */
		e: console.error,

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
	} as const
} as const;

export type LoggerFn = (...args: unknown[]) => void;
