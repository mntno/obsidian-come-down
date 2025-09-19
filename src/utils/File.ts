import { Env } from "../Env";

export class File {

	/**
		*
		* @param path
		* @returns `extension` includes the `.`.
		*/
	public static getPathInfo(path: string) {
		const filename = path.split("/").pop() || Env.str.EMPTY;
		const lastDotIndex = filename.lastIndexOf('.');

		const extension = lastDotIndex > 0 ? filename.substring(lastDotIndex) : Env.str.EMPTY;
		const basename = lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename;

		return { filename, basename, extension };
	}
}
