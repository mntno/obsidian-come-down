import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { SyntaxNodeRef, Tree } from "@lezer/common";
import { Env } from "../Env";

export interface ParsedImage {
	src: string;
	alt?: string;
	from: number;
	to: number;
}

type UrlFilter = (url: string) => boolean;

export class CodeMirrorAssistant {

	/**
		* Checks if the syntax tree currently available in the editor state covers the entire document.
		* @returns `true` if the tree is fully parsed, otherwise `false`.
		*/
	public static isTreeFullyParsed(view: EditorView): boolean {
		return syntaxTree(view.state).length === view.state.doc.length;
	}

	/**
		* Finds images outside the viewport of the whole document.
		*
		* *Note*: Ensures the entire document is parsed before searching. Meaning that if {@link isTreeFullyParsed} returns `false`, this method is slower than {@link findKnownImagesOutsideViewport}.
		*
		* @returns `null` if the parser was unable to finish within the specified timeout.
		*/
	public static findImagesOutsideViewport(view: EditorView, filter?: UrlFilter): ParsedImage[] | null {

		// 500ms timeout as a safeguard against blocking the UI for too long.
		const timeout = 500;
		const tree = ensureSyntaxTree(view.state, view.state.doc.length, timeout);

		if (tree) {
			return CodeMirrorAssistant.findImagesOutsideViewportInTree(view, tree, filter);
		}
		else {
			Env.log.w(`Timed out parsing full syntax tree for the document (${timeout}ms).`);
			return null;
		}
	}

	/**
		* Only searches the already-parsed parts of the document. For example, It won't find images at the very end of a large, un-scrolled file.
		*/
	public static findKnownImagesOutsideViewport(view: EditorView, filter?: UrlFilter) {
		return CodeMirrorAssistant.findImagesOutsideViewportInTree(view, syntaxTree(view.state), filter);
	}

	private static findImagesOutsideViewportInTree(view: EditorView, tree: Tree, filter?: UrlFilter): ParsedImage[] | null {
		const viewport = view.viewport;

		//Env.log.d(`findImagesOutsideViewportInTree: from: ${viewport.from}, to ${viewport.to}, length: ${view.state.doc.length}`);
		//Env.log.d(tree.toString());
		// const now = Env.perf.now();
		// const allImages = CodeMirrorAssistant.findImagesInTreeRange(view, tree, 0, view.state.doc.length, filter);
		// Env.perf.log(`allImages ${allImages.length}: ${allImages.map(i => i.src).join("\n\t")}`, now);

		return [
			...CodeMirrorAssistant.findImagesInTreeRange(view, tree, 0, viewport.from, filter),
			...CodeMirrorAssistant.findImagesInTreeRange(view, tree, viewport.to, view.state.doc.length, filter),
		];
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
			enter: (node: SyntaxNodeRef) => {

				// Frontmatter and code blocks cannot contain (rendered) images.
				if (node.name.includes(NodeName.CODEBLOCK_NODE_PART) || node.name === NodeName.FRONTMATTER_DEF)
					return false;

				// Handle markdown images via tree structure (fast path)
				if (node.name === NodeName.URL) {
					const urlNode = node.node;

					const closingParen = urlNode.nextSibling;
					if (closingParen?.name !== NodeName.URL_FORMATTING)
						return;

					// Extract and filter URL as soon as possible
					const rawUrl = view.state.doc.sliceString(urlNode.from, urlNode.to);
					const urlParts = rawUrl.split(RegEx.URL_SPLIT);
					const url = urlParts.length > 0 ? urlParts[0] : undefined; // Extract just the URL part, excluding possible appended titles and dimensions, e.g.,: `https://example.com/image3.gif "This is a title"`, `https://example.com/image4.jpg =300x200`, `https://example.com/image7.webp "Title text" =250x150`.
					if (url === undefined)
						return;

					if (filter && !filter(url))
						return;

					// Pattern 1: ![alt](url)
					const p1 = urlNode.prevSibling; // (
					const p2 = p1?.prevSibling; // ]
					const p3 = p2?.prevSibling; // alt
					const p4 = p3?.prevSibling; // [
					const p5 = p4?.prevSibling; // !
					if (p1?.name === NodeName.URL_FORMATTING &&
						p2?.name === NodeName.IMAGE_ALT_LINK_FORMATTING &&
						p3?.name === NodeName.IMAGE_ALT_LINK &&
						p4?.name === NodeName.IMAGE_ALT_LINK_FORMATTING &&
						p5?.name === NodeName.IMAGE_MARKER) {
						const alt = view.state.doc.sliceString(p3.from, p3.to);
						images.push({ src: url, alt, from: p5.from, to: closingParen.to });
						return;
					}

					// Pattern 2: ![](url)
					const s1 = urlNode.prevSibling; // ](
					const s2 = s1?.prevSibling; // [
					const s3 = s2?.prevSibling; // !
					if (s1?.name === NodeName.URL_FORMATTING &&
						s2?.name === NodeName.IMAGE_ALT_LINK_FORMATTING &&
						s3?.name === NodeName.IMAGE_MARKER) {
						images.push({ src: url, alt: undefined, from: s3.from, to: closingParen.to });
						return;
					}
				}

				// Handle HTML img tags via targeted text parsing
				if (node.name === NodeName.HTML_BEGIN_TAG) {
					// Find the complete HTML tag by looking for the closing tag
					let current = node.node;
					let endNode = current.nextSibling;

					// Navigate to find the closing bracket
					while (endNode && endNode.name !== NodeName.HTML_END_TAG)
						endNode = endNode.nextSibling;

					if (endNode) {
						const htmlText = view.state.doc.sliceString(current.from, endNode.to);

						// Only process img tags
						if (htmlText.includes('<img')) {
							const srcMatch = htmlText.match(RegEx.HTML_SRC);
							if (srcMatch && srcMatch[1]) {
								const url = srcMatch[1];

								// Apply filter early
								if (filter && !filter(url))
									return;

								const altMatch = htmlText.match(RegEx.HTML_ALT);
								const alt = altMatch?.[1];

								images.push({src: url, alt, from: current.from, to: endNode.to});
							}
						}
					}
				}
			},
		});

		return images;
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
} as const;

// This eliminates the regex compilation overhead on each call. Performance gain might be small, it's still a good practice.
const RegEx = {
	URL_SPLIT: /\s/,
	HTML_SRC: /src=["']([^"']+)["']/,
	HTML_ALT: /alt=["']([^"']*)["']/,
} as const;
