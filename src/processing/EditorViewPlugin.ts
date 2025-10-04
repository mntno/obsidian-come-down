import { EditorView, ViewUpdate } from "@codemirror/view";
import { Env } from "Env";

/**
	* Custom metadata added to the {@link EditorView}.
	* An {@link EditorView} manages plugins and may destroy and create new ones.
	* Thus this metadata outlives the {@link EditorViewPlugin} from which it is fetched, see {@link EditorViewPlugin.getViewMetadata}.
	*/
export interface EditorViewMetadata {
	requesterPath: string | null;
	//newFileDetectedAtSeqNum: number | null;
}

const DEFAULT: EditorViewMetadata = {
	requesterPath: null,
	//newFileDetectedAtSeqNum: null,
}

export interface EditorViewPluginInfo {
	readonly seqNum: number;
}

export class EditorViewPlugin {

	private seqNum = 0;

	constructor(public view: EditorView) {
		Env.log.d("EditorViewPlugin:constructor");
	}

	update(update: ViewUpdate) {
		//Env.log.d("EditorViewPlugin:update", this.getViewMetadata(update.view));
	}

	postUpdate(update: ViewUpdate, handler: (update: ViewUpdate, plugin: EditorViewPlugin, info: EditorViewPluginInfo) => void) {
		Env.log.d("EditorViewPlugin:postUpdate", this.getViewMetadata(update.view));
		handler(update, this, {
			seqNum: this.seqNum++,
		});
	}

	destroy() {
		Env.log.d("EditorViewPlugin:destroy");
	}

	public getViewMetadata(view: EditorView) {
		const v = view as EditorViewWithMetadata;
		return v[METADATA_KEY] ?? DEFAULT;
	}

	/** Save changes immediately if you want them to be available to the next pass (which might begin before the current has finished). */
	public setViewMetadata(view: EditorView, data: EditorViewMetadata) {
		const v = view as EditorViewWithMetadata;
		v[METADATA_KEY] = data;
	}

	public clearViewMetadata(view: EditorView) {
		const v = view as EditorViewWithMetadata;
		delete v[METADATA_KEY];
	}
}

const METADATA_KEY = Symbol("EditorViewMetadata");

interface EditorViewWithMetadata extends EditorView {
	[METADATA_KEY]?: EditorViewMetadata;
}
