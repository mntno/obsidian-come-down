import { Env } from "../Env";
import { Notice as ObsidianNotice } from "obsidian";

export class Notice {
  private innerNotice: ObsidianNotice;

  static NAME: string = Env.str.EMPTY;
  static setName(name: string) {
    this.NAME = name;
  }

  constructor(msg: string, duration?: number, omit: boolean = false) {
    this.innerNotice = new ObsidianNotice(`${omit ? Env.str.EMPTY : `${Notice.NAME}: `}${msg}`, duration);
  }
}
