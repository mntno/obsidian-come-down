import { Env } from "Env";
import { Logger as BaseLogger } from "utils/Logger";

export class Logger extends BaseLogger {

	public beginMsg(...args: unknown[]) {
		if (!Env.isDev)
			return Env.str.EMPTY;

		return `${this.symbol} Begin pass. ${this.joinArgs(args)} ➡️🚪 ${this.idString}`;
	}

	public endMsg(...args: unknown[]) {
		if (!Env.isDev)
			return Env.str.EMPTY;

		return `${this.symbol} End pass. Finished. ${this.joinArgs(args)} ✅🚪➡️ ${this.idString}`;
	}

	public abortMsg(...args: unknown[]) {
		if (!Env.isDev)
			return Env.str.EMPTY;

		return `${this.symbol} End pass. Aborted. ${this.joinArgs(args)} ❌🚪➡️ ${this.idString}`;
	}
}
