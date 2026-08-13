import { Bln, Str } from "utils/ts";

type LogLevel = "trace" | "debug" | "log" | "info" | "warn" | "error";

// Dev-tools mapping:
// 	verbose: debug
// 	info: trace, log, info
// 	warn: warn
// 	error: error, assert

/**
 * Each category's config sets a level — e.g. debug, info, trace — which acts as a minimum severity.
 * A category set to level: "info" will show warn and error messages
 */
const CATEGORY_CONFIG = {
	trace: { enabled: true, level: "trace" },
	console: { enabled: true, level: "debug", label: false },

	/** Edit update pass */
	edit: {
		enabled: true,
		level: "trace",
	},

	/** Post process pass */
	post: {
		enabled: true,
		level: "trace",
	},

	/** Shared by both passes */
	proc: {
		enabled: true,
		level: "trace",
	},

	/** Caching */
	cache: {
		enabled: true,
		level: "trace",
	},

	workaround: {
		enabled: false,
		level: "trace",
	},

	util: {
		enabled: true,
		level: "trace",
	},

} satisfies Record<string, { enabled: boolean; level: LogLevel; label?: boolean }>;

const LEVEL_RANK: Record<LogLevel, number> = { trace: 0, debug: 1, log: 2, info: 3, warn: 4, error: 5 };

const isProduction = process.env["NODE_ENV"] === "production";
const realConsole: Console = console;

function noop(): void { }

/**
 * Stack traces for logger getters look like:
 *   at getCallerLabel (log.ts)
 *   at get d [as d] (log.ts)        <- getter, to skip
 *   at get t [as t] (log.ts)        <- outer `log.t` getter, to skip
 *   at findContainer (ContainerObserver.ts:74) <- desired caller
 * Filtering by `log.ts`/`CategoryLogger` plus `get` frames keeps click-to-source
 * intact while still extracting `Class:method` / `Class:constructor`.
 */
function getCallerLabel(): string {
	const stack = new Error().stack;
	if (stack === undefined) return Str.empty;

	const lines = stack.split("\n");
	let afterGetCaller = false;

	for (const line of lines) {
		if (!afterGetCaller) {
			if (line.includes("getCallerLabel")) afterGetCaller = true;
			continue;
		}
		if (!/at\s+/.test(line)) continue;
		if (isInternalLogFrame(line)) continue;

		const isConstructor = /at\s+new\s+/.test(line);
		const match = line.match(/at\s+(?:new\s+)?([^\s(]+)/);
		if (match === null) continue;

		let name = match[1] || Str.empty;
		if (isGetterFrameName(name)) continue;
		if (name === "getCallerLabel") continue;

		name = name.replace(/^_+/, Str.empty);
		if (name === Str.empty) continue;

		return isConstructor ? `${name}:constructor` : name.replace(".", ":");
	}
	return Str.empty;
}

function isInternalLogFrame(line: string): boolean {
	return /CategoryLogger|log\.(ts|js)/.test(line);
}

function isGetterFrameName(name: string): boolean {
	return name === "get" || name.startsWith("get ");
}

class CategoryLogger {
	private readonly prefix: string;
	private readonly indentedPrefix: string;
	private readonly cfg: { enabled: boolean; level: LogLevel; label?: boolean };

	public static create(category: keyof typeof CATEGORY_CONFIG): CategoryLogger {
		return new CategoryLogger(category);
	}

	public constructor(category: keyof typeof CATEGORY_CONFIG) {
		this.prefix = `[${category}]${Str.tab}`;
		this.indentedPrefix = "  " + this.prefix;
		this.cfg = CATEGORY_CONFIG[category];
	}

	private shouldLog(level: LogLevel): boolean {
		if (isProduction) return level === "warn" || level === "error";
		return this.cfg.enabled && LEVEL_RANK[level] >= LEVEL_RANK[this.cfg.level];
	}

	private useLabel(): boolean {
		return !isProduction && !Bln.isFalse(this.cfg.label);
	}

	/** Bind console fn with prefix and — when enabled — a per-access caller label. Uses `bind` to preserve click-to-source. */
	private bindConsole<F extends (...args: unknown[]) => void>(fn: F, indent: boolean): F {
		const prefix = indent ? this.indentedPrefix : this.prefix;
		if (!this.useLabel()) return fn.bind(realConsole, prefix) as F;
		return fn.bind(realConsole, prefix, getCallerLabel()) as F;
	}

	public get t(): Console["trace"] {
		if (!this.shouldLog("trace")) return noop;
		return this.bindConsole(realConsole.trace, false);
	}

	public get d(): Console["debug"] {
		if (!this.shouldLog("debug")) return noop;
		return this.bindConsole(realConsole.debug, true);
	}

	public get l(): Console["log"] {
		if (!this.shouldLog("log")) return noop;
		return this.bindConsole(realConsole.log, true);
	}

	public get i(): Console["info"] {
		if (!this.shouldLog("info")) return noop;
		return this.bindConsole(realConsole.info, true);
	}

	public get w(): Console["warn"] {
		if (!this.shouldLog("warn")) return noop;
		if (isProduction) return realConsole.warn;
		return this.bindConsole(realConsole.warn, true);
	}

	public get e(): Console["error"] {
		if (!this.shouldLog("error")) return noop;
		if (isProduction) return realConsole.error;
		return this.bindConsole(realConsole.error, true);
	}
}

// Normal console usage, eg: console.log
const c = CategoryLogger.create("console");
const traceLogger = CategoryLogger.create("trace");

export const log = {
	get t(): Console["trace"] { return traceLogger.t; },
	get d(): Console["debug"] { return c.d; },
	get l(): Console["log"] { return c.l; },
	get i(): Console["info"] { return c.i; },
	w: realConsole.warn,
	e: realConsole.error,
	assert: realConsole.assert,
	catch: realConsole.error,

	edit: CategoryLogger.create("edit"),
	post: CategoryLogger.create("post"),
	proc: CategoryLogger.create("proc"),
	cache: CategoryLogger.create("cache"),
	util: CategoryLogger.create("util"),
	workaround: CategoryLogger.create("workaround"),

	tab: Str.tab,
	lfTab: Str.lf + Str.tab,
};
