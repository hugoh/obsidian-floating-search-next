import type { PreviewState } from "./nativeModal";

const HIGHLIGHT_NAME = "search-open-match";
const GIVE_UP_AFTER_MS = 3000;

/** The part of the CSS Custom Highlight registry this file uses. */
interface HighlightRegistry {
  set(name: string, highlight: Highlight): unknown;
  delete(name: string): unknown;
}

/** The distinct, lower-cased text a result row matched. */
export function matchedTerms(match: PreviewState["match"]): string[] {
  const { content, matches } = match ?? {};
  if (!content || !matches) return [];
  const terms = new Set<string>();
  for (const offsets of matches) {
    if (!Array.isArray(offsets)) continue;
    const [start, end] = offsets as unknown[];
    if (typeof start !== "number" || typeof end !== "number") continue;
    const term = content.slice(start, end).toLowerCase();
    if (term.trim()) terms.add(term);
  }
  return [...terms];
}

function rangesFor(block: Element, terms: string[]): Range[] {
  const doc = block.ownerDocument;
  const ranges: Range[] = [];
  const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node as Text).data.toLowerCase();
    for (const term of terms) {
      for (
        let at = text.indexOf(term);
        at !== -1;
        at = text.indexOf(term, at + term.length)
      ) {
        const range = doc.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + term.length);
        ranges.push(range);
      }
    }
  }
  return ranges;
}

/**
 * Reading mode only flashes the block holding the match, then leaves nothing.
 * This marks the matched text inside that block until the returned function is
 * called, without touching the rendered DOM.
 */
export function markMatch(
  container: HTMLElement | undefined,
  match: PreviewState["match"],
): () => void {
  const terms = matchedTerms(match);
  const registry = (typeof CSS === "undefined" ? undefined : CSS.highlights) as
    | HighlightRegistry
    | undefined;
  if (!container || !registry || terms.length === 0) return () => {};

  const mark = () => {
    const block = container.querySelector(".is-flashing");
    const ranges = block ? rangesFor(block, terms) : [];
    if (ranges.length === 0) return false;
    registry.set(HIGHLIGHT_NAME, new Highlight(...ranges));
    return true;
  };

  // The block may not be rendered, or not flashing yet, when the file opens.
  const observer = new MutationObserver(() => {
    if (mark()) observer.disconnect();
  });
  if (!mark()) {
    observer.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  }
  const giveUp = window.setTimeout(() => observer.disconnect(), GIVE_UP_AFTER_MS);

  return () => {
    observer.disconnect();
    window.clearTimeout(giveUp);
    registry.delete(HIGHLIGHT_NAME);
  };
}
