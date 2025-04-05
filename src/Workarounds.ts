import { Log } from "Environment";
import { ViewUpdate } from "@codemirror/view";
import { Url } from "Url";
import { HtmlAssistant, HTMLElementAttribute, HTMLElementCacheState } from "HtmlAssistant";


export class Workarounds {

  /**
   * If there is a Markdown link at any point after an empty embedded syntax
   * (i.e., "\!\[\]\(\)" or "\!\[\]\(") an `img` element will be insterted with the `src` attribute
   * set to the `href` of the link!
   * 
   * Therefore, when the user types "\!\[\]\(\)" the plugin will start downloading the `href` url.
   * 
   * Outstanding related issues:
   * 
   * - As this method only looks at changes, if a note is loaded containing "\!\[\]\(\)" or "\!\[\]\(") with a Markdown link after it, it slips through.
   * - When note contain "\!\[\]\(", moving the cursor around seems to reset the inserted `img`, which will trigger download.
   * - If the Markdown link is modified while there is a "\!\[\]\(\)" or "\!\[\]\(" above it.
   * - If there is a code block after "\!\[\]\(\)" or "\!\[\]\(" containing a Markdown link this link will not cause the issue to arise, but the regex matches with that link rather than any link after the code block which is the real cause.
   *   Pursuing this particular edge case is not worth it because it will likely include to regex searches to discard Markdown links in code blocks.
   * 
   * The additional processing in these rare edge cases might not be worth addressing. 
   * The important part is to prevent downloads when the user is engaging with the link.
   * 
   * @param update 
   * @returns The URLs of `img` elements in the DOM that should be ignored or `null` if there are none.
   */
  public static detectSourcesOfInvalidImageElements(update: ViewUpdate) {
    if (update.changes.empty)
      return null;

    var sourcesToIgnore: string[] = [];

    update.changes.iterChanges((_fromA, _toA, cursorStartPos, cursorEndPosition, inserted) => {

      const insertedText = inserted.toString();
      const doc = update.state.doc;
      const line = doc.lineAt(cursorStartPos);
      const modifiedLine = doc.sliceString(line.from, line.to) + "\n";

      Log(`Workarounds: Inserted ${cursorStartPos}/${cursorEndPosition}: ${insertedText}`);
      Log(`Workarounds: Modified line: ${modifiedLine}, match: ${this.embeddedImageRegex.test(modifiedLine)}`);

      if (this.embeddedImageRegex.test(modifiedLine)) {

        // Scan for the first markdown link after the cursor
        const textAfterCursor = doc.sliceString(cursorEndPosition);
        const match = this.markdownLinkRegex.exec(textAfterCursor);

        //Log(`Text after: ${textAfterCursor}`);

        if (match) {
          const linkUrl = match[1];
          Log(`Workarounds: Found image src to ignore: ${linkUrl}`);

          // The image element is only inserted when the link protocol is recognized, i.e., 
          // when it begins with `http:`, `https:`, `ftp:`, `ws:`, or `wss:`.
          // So no need to check if the url is valid or external here. Insert.
          sourcesToIgnore.push(linkUrl);
        }
      }
    });

    return sourcesToIgnore.length > 0 ? sourcesToIgnore : null;
  }

  /**
   * Matches all cases where the invalid image element is inserted.
   * 
   * - \!\[\]\(\)
   * - \!\[\]\(
   * - \!\[abc\]\(\)
   * - \!\[\]\(abc
   */
  private static readonly embeddedImageRegex = /!\[(.*?)\]\((.*?)\)?/;

  /**
   * Use to find the first Markdown link in a string.
   * 
   * Will not match if there's no link because an img element is not inserted until the link 
   * begins with `http:`, `https:`, `ftp:`, `ws:`, or `wss:`.
   */
  private static readonly markdownLinkRegex = /\[.*?\]\((.+?)\)/;


  /**
   * 
   * @param sourcesToIgnore Result of having called {@link detectSourcesOfInvalidImageElements}
   * @param imageElement 
   * @param src The `src` of the {@link imageElement} parameter. Check existance before calling.
   * @returns `false` when the {@link imageElement}'s state was set to {@link HTMLElementCacheState.INVALID} and should be filtered out of furter processing.
   */
  public static HandleInvalidImageElements(sourcesToIgnore: string[] | null, imageElement: HTMLImageElement, src: string): boolean {
    if (sourcesToIgnore) {
      for (const sourceToIgnore of sourcesToIgnore) {
        if (Url.trimBackslash(sourceToIgnore) === Url.trimBackslash(src)) {
          imageElement.removeAttribute(HTMLElementAttribute.SRC); // Shouldn't be necessary but why keep it.
          HtmlAssistant.setCacheState(imageElement, HTMLElementCacheState.INVALID); // Set to invalid so that the next pass ignores it.					
          return false;
        }
      }
    }

    return true;
  }
}