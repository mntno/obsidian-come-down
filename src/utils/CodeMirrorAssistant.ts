import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { SyntaxNodeRef, Tree } from "@lezer/common";
import { Env } from "Env";

export interface ParsedImage {
	src: string;
	alt?: string;
	from: number;
	to: number;
}

type UrlFilter = (url: string) => boolean;

export class CodeMirrorAssistant {

	public static contentDomFromViewUpdate(viewUpdate: ViewUpdate) {
		return viewUpdate.view.contentDOM;
	}

	/**
		* Checks if the syntax tree currently available in the editor state covers the entire document.
		* @returns `true` if the tree is fully parsed, otherwise `false`.
		*/
	public static isTreeFullyParsed(view: EditorView): boolean {
		return syntaxTree(view.state).length === view.state.doc.length;
	}

	public static findAllImages(view: EditorView, filter?: UrlFilter): ParsedImage[] | null {
		const tree = CodeMirrorAssistant.ensureSyntaxTree(view);
		return tree === null ? null : CodeMirrorAssistant.findImagesInTreeRange(view, tree, 0, view.state.doc.length, filter);
	}

	/**
		* Finds images outside the viewport of the whole document.
		*
		* *Note*: Ensures the entire document is parsed before searching. Meaning that if {@link isTreeFullyParsed} returns `false`, this method is slower than {@link findKnownImagesOutsideViewport}.
		*
		* @returns `null` if the parser was unable to finish within the specified timeout.
		*/
	public static findImagesOutsideViewport(view: EditorView, filter?: UrlFilter): ParsedImage[] | null {
		const tree = CodeMirrorAssistant.ensureSyntaxTree(view);
		return tree === null ? null : CodeMirrorAssistant.findImagesOutsideViewportInTree(view, tree, filter);
	}

	/**
		* Only searches the already-parsed parts of the document. For example, It won't find images at the very end of a large, un-scrolled file.
		*/
	public static findKnownImagesOutsideViewport(view: EditorView, filter?: UrlFilter) {
		return CodeMirrorAssistant.findImagesOutsideViewportInTree(view, syntaxTree(view.state), filter);
	}

	private static findImagesOutsideViewportInTree(view: EditorView, tree: Tree, filter?: UrlFilter): ParsedImage[] {
		const viewport = view.viewport;

		// Env.log.d(`findImagesOutsideViewportInTree: from: ${viewport.from}, to ${viewport.to}, length: ${view.state.doc.length}`);
		// Env.log.d(tree.toString());
		// const now = Env.perf.now();
		const allImages = CodeMirrorAssistant.findImagesInTreeRange(view, tree, 0, view.state.doc.length, filter);
		// Env.perf.log(`allImages ${allImages.length}: ${allImages.map(i => i.src).join("\n\t")}`, now);

		//return CodeMirrorAssistant.findImagesInTreeRange(view, tree, viewport.from, viewport.to, filter);

		return allImages.filter(image => {
			const isFullyOutside = image.to <= viewport.from || image.from >= viewport.to;
			const isCrossingStart = image.from < viewport.from && image.to > viewport.from;
			const isCrossingEnd = image.from < viewport.to && image.to > viewport.to;
			Env.dev.assert(isCrossingStart === false && isCrossingEnd === false)
			return isFullyOutside || isCrossingStart || isCrossingEnd;
		});
	}

	/**
		* @param view
		* @param tree Tree to search within.
		* @param from
		* @param to If position is greater than the length of the currently parsed tree (`tree.length`), it does not cause an error. The iterator will start at {@link from} and stop when it reaches the end of the parsed tree content, even if that is short of this position.
		* @returns
		*/
	private static findImagesInTreeRange(view: EditorView, tree: Tree, from: number, to: number, filter?: UrlFilter): ParsedImage[] {
		const images: ParsedImage[] = [];

		tree.iterate({
			from,
			to,
			enter: (nodeRef) => {
				const node = nodeRef.node;

				if (node.name.includes(NodeName.CODEBLOCK_NODE_PART) || node.name.startsWith(NodeName.FRONTMATTER_DEF)) {
					return false;
				}

				// --- Markdown Image Logic ---
				if (node.name.startsWith(NodeName.IMAGE_MARKER)) {
					if (images.some(img => node.from >= img.from && node.to <= img.to)) return;

					let urlNode = null;
					let altNode = null;
					let closingParenNode = null;

					let currentNode = node.nextSibling;
					while (currentNode) {
						if (currentNode.name.startsWith(NodeName.IMAGE_MARKER)) break;

						const isUrlNode = currentNode.name.endsWith(NodeName.URL) && !currentNode.name.includes(NodeName.FORMATTING);
						const isAltNode = currentNode.name.startsWith(NodeName.IMAGE_ALT_LINK);

						if (!urlNode && isUrlNode) {
							urlNode = currentNode;
						} else if (!altNode && isAltNode) {
							altNode = currentNode;
						}

						if (urlNode) {
							const isUrlFormatting = currentNode.name.startsWith(NodeName.LINK_FORMATTING) && currentNode.name.endsWith(NodeName.URL);
							const isAfterUrl = currentNode.from > urlNode.from;
							if (isUrlFormatting && isAfterUrl) {
								closingParenNode = currentNode;
								break;
							}
						}
						currentNode = currentNode.nextSibling;
					}

					if (urlNode && closingParenNode) {
						const rawUrl = view.state.doc.sliceString(urlNode.from, urlNode.to);
						const urlParts = rawUrl.split(RegEx.URL_SPLIT);
						const url = urlParts.length > 0 ? urlParts[0] : undefined;
						if (url === undefined) return;

						if (filter && !filter(url)) return;

						const alt = altNode ? view.state.doc.sliceString(altNode.from, altNode.to) : "";

						images.push({ src: url, alt, from: node.from, to: closingParenNode.to });
					}
				}

				// --- HTML Image Logic ---
				if (node.name.startsWith(NodeName.HTML_BEGIN_TAG)) {
					if (images.some(img => node.from >= img.from && node.to <= img.to)) return;

					let endNode = null;
					let currentNode = node.nextSibling;
					while(currentNode) {
						if (currentNode.name.startsWith(NodeName.HTML_END_TAG)) {
							endNode = currentNode;
							break;
						}
						if (currentNode.name.startsWith(NodeName.HTML_BEGIN_TAG)) break;
						currentNode = currentNode.nextSibling;
					}

					if (endNode) {
						const text = view.state.doc.sliceString(node.from, endNode.to);
						if (text.includes("<img")) {
							const srcMatch = text.match(RegEx.HTML_SRC);
							if (srcMatch && srcMatch[1]) {
								const url = srcMatch[1];
								if (filter && !filter(url)) return;

								const altMatch = text.match(RegEx.HTML_ALT);
								const alt = altMatch?.[1];

								images.push({ src: url, alt, from: node.from, to: endNode.to });
							}
						}
					}
				}
			},
		});

		return images;
	}

	private static ensureSyntaxTree(view: EditorView): Tree | null {
		// 500ms timeout as a safeguard against blocking the UI for too long.
		const timeout = 500;
		const tree = ensureSyntaxTree(view.state, view.state.doc.length, timeout);

		if (tree === null)
			Env.log.w(`Timed out parsing full syntax tree for the document (${timeout}ms).`);

		return tree;
	}
}

const NodeName = {
	URL: "string_url",
	URL_FORMATTING: "formatting_formatting-link-string_string_url",
	IMAGE_MARKER: "formatting_formatting-image_image_image-marker",
	IMAGE_ALT_LINK_FORMATTING: "formatting_formatting-image_image_image-alt-text_link",
	IMAGE_ALT_LINK: "image_image-alt-text_link",
	HTML_BEGIN_TAG: "bracket_hmd-html-begin_tag",
	HTML_END_TAG: "bracket_hmd-html-end_tag",
	FRONTMATTER_DEF: "def_hmd-frontmatter",
	/** All nodes related to a code block seem to have this as part of their name. Thus use `include`: `node.name.includes(NodeName.CODEBLOCK_NODE_PART`. */
	CODEBLOCK_NODE_PART: "HyperMD-codeblock",
	FORMATTING: "formatting",
	LINK_FORMATTING: "formatting_formatting-link-string",
} as const;

// This eliminates the regex compilation overhead on each call. Performance gain might be small, it's still a good practice.
const RegEx = {
	URL_SPLIT: /\s/,
	HTML_SRC: /src=["']([^"']+)["']/,
	HTML_ALT: /alt=["']([^"']*)["']/,
} as const;
