import { EditorView, ViewUpdate } from "@codemirror/view";
import { MarkdownView, MarkdownPostProcessorContext, FileView, TFile, App } from "obsidian";
import { Log, ENV } from "Environment";
import { CacheRequest, CacheManager } from "CacheManager";

/**
 * - Gathers some state useful during the current pass. 
 * - Call first in system callbacks to abort as early as possible.
 */
export class ProcessingPass {

	private markdownView: MarkdownView | null;
	public associatedFile: TFile;

	/** `true` when invoked by the Markdown post processor. */
	public isInPostProcessingPass: boolean;
	private viewUpdate?: ViewUpdate;

	private static updatePassID: number = 0;
	private static postProcessorPassID: number = 0;
	public passID: number;

	public static beginFromViewUpdate(app: App, viewUpdate: ViewUpdate, noFile: () => void, sourceMode?: () => void): ProcessingPass | null {

		const processPassID = this.updatePassID++;

		if (ENV.dev) {

			const updated = this.viewUpdateChanges(viewUpdate);
			const changed = Object.keys(updated).filter(key => updated[key]);
			const notChanged = Object.keys(updated).filter(key => !updated[key]);
			
			Log(`🥎 editorViewUpdateListener ${changed.length} view updates. 🛎️ ID ${processPassID}`);
			if (changed.length > 0)
				Log(`\t🟢 ${changed.join(", ")}`);
			if (changed.length > 0 && notChanged.length > 0)
				Log(`\t🔴 ${notChanged.join(", ")}`);
		}

		const markdownView = app.workspace.getActiveViewOfType(MarkdownView);
		const associatedFile = markdownView?.file ?? null;

		// `app.workspace.getActiveFile()` is of no help.
		if (!associatedFile) {
			Log(`\tNo associated file. ID ${processPassID}`);
			noFile();
			return null;
		}
		else if (markdownView && this.isInSourceMode(markdownView)) {
			sourceMode?.();
			return null;
		}
		else {
			const instance = new this();
			instance.passID = processPassID;
			instance.markdownView = markdownView;
			instance.associatedFile = associatedFile;
			instance.isInPostProcessingPass = false;
			instance.viewUpdate = viewUpdate;

			return instance;
		}
	}

	public static beginFromPostProcessorContext(app: App, context: MarkdownPostProcessorContext) : ProcessingPass {
		
		const postProcessorPassID = this.postProcessorPassID++;

		Log(`🏀 postProcessReadingModeHtml 🛎️ ID ${postProcessorPassID}`);

		const instance = new this();
		instance.passID = postProcessorPassID;
		instance.isInPostProcessingPass = true;

		instance.markdownView = app.workspace.getActiveViewOfType(MarkdownView);

		let associatedFile = instance.markdownView?.file ?? app.vault.getFileByPath(context.sourcePath);
		console.assert(associatedFile);
		instance.associatedFile = associatedFile!;

		return instance;
	}

	private static viewUpdateChanges(viewUpdate: ViewUpdate) {
		const u: Record<string, boolean> = {};

		u["docChanged"] = viewUpdate.docChanged;
		u["viewportChanged"] = viewUpdate.viewportChanged;
		u["selectionSet"] = viewUpdate.selectionSet;
		u["focusChanged"] = viewUpdate.focusChanged;
		u["geometryChanged"] = viewUpdate.geometryChanged;
		u["heightChanged"] = viewUpdate.heightChanged;
		u["viewportMoved"] = viewUpdate.viewportMoved; 

		return u;
	}

	private static isInLivePreviewFromView(view: FileView) {
		const state = view?.getState();
		return state ? state.mode == "source" && state.source == false : false;
	}

	private static isInSourceMode(view: FileView) {
		const state = view?.getState();
		return state ? state.mode == "source" && state.source == true : false;
	}

	/**
	 * The {@link EditorView.updateListener.of} {@link Extension} is called in both reader and preview/source mode and let's you process all elements at once.
	 * The {@link registerMarkdownPostProcessor} is only called first when the file is opened in reader mode. It is called several times as the DOM is beeing built, which makes it complicated to consolidate them into one call.
	 * 
	 * Because the update listener extension callback supplies the DOM of the whole file's writing area, and further, because it is always run before the Markdown post processor,
	 * it is enough and simplest to show the download notice only when invoked from the extension callback, i.e., when {@link processingContext.isInPostProcessingPass} is `true`.
	 * 
	 * 
	 * @param processingContext 
	 * @param run  
	 * @returns 
	 */
	public runInUpdatePass(run?: () => void) {
		if (this.isInUpdatePass) {
			run?.();
			return true;
		}
		return false;
	}

	public get isInUpdatePass() {
		return this.viewUpdate ? true : false;
	}

	public retainCacheFromRequest(request: CacheRequest) {
		console.assert(request.requesterPath == this.associatedFile.path);
		if (this.isInUpdatePass)
			this.requestsToRetain.push(request);
	}

	public get currentNumberOfRequestsToRetain() {
		return this.requestsToRetain.length;
	}

	private requestsToRetain: CacheRequest[] = [];

	public end(cacheManager: CacheManager) {
		Log(`${this.isInUpdatePass ? `🥎 ProcessingPass:end: Update pass ✅ ID ${this.passID}` : `🏀 ProcessingPass:end: Post processing pass ✅ ID ${this.passID}`}`);

		if (this.isInUpdatePass) {
			cacheManager.updateRetainedCaches(this.requestsToRetain, this.associatedFile.path).then(() => {
					Log(`\tSaving metadata: ID ${this.passID}`);
					cacheManager.saveMetadataIfDirty();				
			});
		}
	}

	public abort() {
		Log(`${this.isInUpdatePass ? `🥎 ProcessingPass:abort: Update pass ⛔ ID ${this.passID}` : `🏀 ProcessingPass:end: Post processing pass ⛔ ID ${this.passID}`}`);		
	}

}
