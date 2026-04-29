import { Env, LoggerFn } from "Env";

export class Logger {

	public readonly log: LoggerFn;
	public readonly id: number;
	public readonly symbol: string;
	public readonly t = (action: () => string) => Env.isDev ? action() : Env.str.EMPTY;

	constructor(log: LoggerFn, id: number, symbol: string) {
		this.log = log;
		this.id = id;
		this.symbol = symbol;
	}

	public get idString() {
		return "— ID" + this.id;
	}

	protected joinArgs(args: unknown[]): string {
		return args.length === 0 ? Env.str.EMPTY : `(${args.join(Env.str.SPACE)})`;
	}

	/**
	 * Formats the args for logging.
	 * @throws {TypeError} If a value of type {@link Symbol} is passed, mirroring `Array.prototype.join`'s behavior.
	 */
	public msg(...args: unknown[]): string {
		if (!Env.isDev)
			return Env.str.EMPTY;

		const body = args.length > 0
			? ` ${args.map(String).join(Env.str.SPACE)}`
			: Env.str.EMPTY;

		return `${this.symbol}${body} ${this.idString}`;
	}
}
