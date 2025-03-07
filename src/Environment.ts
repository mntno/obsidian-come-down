import { Notice as ObsidianNotice } from "obsidian";

const isProduction = process.env.NODE_ENV === "production";

export const ENV = {
  processOnAllViewUpdateChanges: true,
  dev: !isProduction,
  debugLog: !isProduction,
} as const;

export const Log = ENV.debugLog
  ? (msg: string, error?: Error): void => {
      if (error) {
        console.log(msg, error);
      } else {
        console.log(msg);
      }
    }
  : (): void => {};

export class Notice {
  private innerNotice: ObsidianNotice;

  static NAME: string = "";
  static setName(name: string) {
    this.NAME = name;
  }

  constructor(msg: string, duration?: number, omit: boolean = false) {
    this.innerNotice = new ObsidianNotice(`${omit ? "" : `${Notice.NAME}: `}${msg}`, duration);
  }
}
