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
		return args.length === 0 ? Env.str.EMPTY : `(${args.join(" ")})`;
	}

	public msg(...args: unknown[]) {
		if (!Env.isDev)
			return Env.str.EMPTY;

		const mappedArgs = args.map(arg => arg === undefined ? "undefined" : arg);
		return `${this.symbol} ${mappedArgs.join(Env.str.SPACE)} ${this.idString}`;
	}
}
