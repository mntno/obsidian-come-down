import { Env } from "Env";
import { Logger as BaseLogger } from "utils/Logger";

export class Logger extends BaseLogger {

	public beginMsg(...args: unknown[]) {
		if (!Env.isDev) return "";
		const joinedArgs = args.length > 0 ? `(${args.join(" ")})` : "";
		return `${this.symbol} Begin pass. ${joinedArgs} ➡️🚪 ${this.idString}`;
	}

	public endMsg(...args: unknown[]) {
		if (!Env.isDev) return "";
		const joinedArgs = args.length > 0 ? `(${args.join(" ")})` : "";
		return `${this.symbol} End pass. Finished. ${joinedArgs} ✅🚪➡️ ${this.idString}`;
	}

	public abortMsg(...args: unknown[]) {
		if (!Env.isDev) return "";
		const joinedArgs = args.length > 0 ? `(${args.join(" ")})` : "";
		return `${this.symbol} End pass. Aborted. ${joinedArgs} ❌🚪➡️ ${this.idString}`;
	}
}
