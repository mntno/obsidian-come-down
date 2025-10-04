import { Env, LoggerFn } from "Env";

export class Logger {

	public readonly log: LoggerFn;
	public readonly id: number;
	public readonly symbol: string;
	public readonly t = (action: () => string) => Env.isDev ? action() : "";

	constructor(log: LoggerFn, id: number, symbol: string) {
		this.log = log;
		this.id = id;
		this.symbol = symbol;
	}

	public get idString() {
		return "— ID" + this.id;
	}

	public msg(...args: unknown[]) {
		if (!Env.isDev) return "";
		const mappedArgs = args.map(arg => arg === undefined ? "undefined" : arg);
		return `${this.symbol} ${mappedArgs.join(" ")} ${this.idString}`;
	}
}