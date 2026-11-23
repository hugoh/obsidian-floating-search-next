import { around } from "monkey-around";
import type { App, SearchResult, SearchView } from "obsidian";
import {
  addIcon,
  debounce,
  prepareFuzzySearch,
  prepareSimpleSearch,
  setIcon,
  TFile,
} from "obsidian";
import { strings } from "./i18n";
import { compileSafeRegex, truncateForRegex } from "./regex";

export interface FilterHost {
  settings: {
    filterIncludeBases: boolean;
    filterIncludeCanvas: boolean;
    filterStarredOnly: boolean;
    filterMatchCase: boolean;
    filterUseRegex: boolean;
  };
  saveSettings: () => Promise<void>;
  app: App;
}

const CASE_ICON = "pane-search-case";
const REGEX_ICON = "pane-search-regex";

// Phosphor icons drawn on a 256 grid, scaled into Obsidian's 100x100 icon slot.
const FILTER_ICONS: Record<string, string> = {
  [CASE_ICON]: `<path d="M90.86,50.89a12,12,0,0,0-21.72,0l-64,136a12,12,0,0,0,21.71,10.22L42.44,164h75.12l15.58,33.11a12,12,0,0,0,21.72-10.22ZM53.74,140,80,84.18,106.27,140ZM200,84c-13.85,0-24.77,3.86-32.45,11.48a12,12,0,1,0,16.9,17c3-3,8.26-4.52,15.55-4.52,11,0,20,7.18,20,16v4.39A47.28,47.28,0,0,0,200,124c-24.26,0-44,17.94-44,40s19.74,40,44,40a47.18,47.18,0,0,0,22-5.38A12,12,0,0,0,244,192V124C244,101.94,224.26,84,200,84Zm0,96c-11,0-20-7.18-20-16s9-16,20-16,20,7.18,20,16S211,180,200,180Z"/>`,
  [REGEX_ICON]: `<circle cx="46" cy="128" r="22"/><g transform="translate(48 8) scale(0.78)"><path d="M212.45,107.14l-65.19,26.08,46.21,59.41a12,12,0,1,1-18.94,14.74L128,147.55,81.47,207.37a12,12,0,0,1-18.94-14.74l46.21-59.41L43.55,107.14a12,12,0,1,1,8.91-22.28L116,110.28V40a12,12,0,0,1,24,0v70.28l63.54-25.42a12,12,0,1,1,8.91,22.28Z"/></g>`,
};

export function registerFilterIcons(): void {
  for (const [name, shapes] of Object.entries(FILTER_ICONS)) {
    addIcon(
      name,
      `<g transform="scale(0.390625)" fill="currentColor">${shapes}</g>`,
    );
  }
}

interface BookmarkItem {
  type?: string;
  path?: string;
  items?: BookmarkItem[];
  children?: BookmarkItem[];
}

interface BookmarksPlugin {
  getBookmarks?(): BookmarkItem[];
}

/** The core Bookmarks plugin has no public API, so reach it defensively. */
interface InternalPluginHost {
  internalPlugins?: {
    getEnabledPluginById?(id: string): BookmarksPlugin | undefined;
    plugins?: { bookmarks?: { instance?: BookmarksPlugin } };
  };
}

export function getBookmarkedPaths(app: App): Set<string> {
  const paths = new Set<string>();
  const { internalPlugins } = app as unknown as InternalPluginHost;
  const bookmarks =
    internalPlugins?.getEnabledPluginById?.("bookmarks") ??
    internalPlugins?.plugins?.bookmarks?.instance;
  const walk = (item: BookmarkItem | undefined) => {
    if (!item) return;
    if (item.type === "file" && typeof item.path === "string") {
      paths.add(item.path);
    }
    item.items?.forEach(walk);
    item.children?.forEach(walk);
  };
  const items = bookmarks?.getBookmarks?.();
  if (Array.isArray(items)) items.forEach(walk);
  return paths;
}

export function isFileAllowed(
  plugin: FilterHost,
  file: TFile,
  bookmarks: Set<string> | null,
): boolean {
  if (bookmarks && !bookmarks.has(file.path)) return false;
  if (file.extension === "base") return plugin.settings.filterIncludeBases;
  if (file.extension === "canvas") return plugin.settings.filterIncludeCanvas;
  return true;
}

export function compileQueryRegex(
  plugin: FilterHost,
  query: string,
): RegExp | null {
  if (!plugin.settings.filterUseRegex || !query.trim()) return null;
  return compileSafeRegex(query, plugin.settings.filterMatchCase ? "m" : "im");
}

/** Use the native parser for regex searches, rather than filtering a literal search. */
export function buildNativeRegexQuery(
  plugin: FilterHost,
  query: string,
): string {
  if (!plugin.settings.filterUseRegex || !query.trim()) return query;
  const source = compileQueryRegex(plugin, query)?.source ?? "(?!)";
  // Obsidian's query tokenizer treats every unescaped slash as a delimiter,
  // including slashes inside character classes (which RegExp.source leaves raw).
  const escaped = source.replace(/\//g, (_slash, offset: number) => {
    let backslashes = 0;
    for (let i = offset - 1; i >= 0 && source[i] === "\\"; i--) backslashes++;
    return backslashes % 2 ? "/" : "\\/";
  });
  return `/${escaped}/ OR path:/${escaped}/`;
}

/** Adapt only this floating view; keep the input and persisted query unmodified. */
export function bindNativeRegexSearch(
  view: SearchView,
  plugin: FilterHost,
  onQueryChange?: () => void,
): () => void {
  const target = view;
  const component = view.searchComponent as SearchView["searchComponent"] & {
    changeCallback?: (value: string) => void;
  };
  if (
    typeof target.startSearch !== "function" ||
    typeof component?.getValue !== "function"
  ) {
    return () => {};
  }
  const unpatch = around(target, {
    startSearch(old) {
      return function () {
        // The original is put back by assignment below, never called unbound.
        // eslint-disable-next-line @typescript-eslint/unbound-method -- restored by assignment, not invoked detached
        const getValue = component.getValue;
        // startSearch reads its query synchronously, before requesting layout saves.
        // Restore on the first read so state/history always retain the user's input.
        component.getValue = () => {
          component.getValue = getValue;
          return buildNativeRegexQuery(plugin, getValue.call(component));
        };
        try {
          return old.call(this);
        } finally {
          component.getValue = getValue;
        }
      };
    },
  });
  // Native SearchView captures startSearch.bind(this) in its constructor.
  // Replace only this component's callback so typing uses the live adapter too.
  const originalChange = component.changeCallback;
  const search = debounce(() => target.startSearch(), 0, true);
  const onChange = (query: string) => {
    onQueryChange?.();
    view.dom?.setFocusedItem?.(null);
    target.stopSearch?.();
    search.cancel();
    if (query) search();
    else {
      target.startSearch();
      target.infoEl?.hide();
    }
  };
  const canBindChange =
    typeof component.onChange === "function" &&
    typeof originalChange === "function";
  if (canBindChange) component.onChange(onChange);
  return () => {
    search.cancel();
    if (canBindChange && component.changeCallback === onChange) {
      component.onChange(originalChange);
    }
    unpatch();
  };
}

export type MatchTarget = "name" | "content";

/**
 * Prepare a matcher for one query, so the work of compiling a pattern or
 * building a searcher is done once, not once per file.
 *
 * In the default mode names, paths and headings match fuzzily, while note
 * bodies match exact words (a fuzzy match over a whole body also accepts near
 * misses such as `marker17` for `marker7`). Match-case and regex modes are
 * exact for both.
 */
export function createTextMatcher(
  plugin: FilterHost,
  query: string,
  target: MatchTarget = "name",
): (text: string) => SearchResult | null {
  if (!query.trim()) return () => null;
  const { filterUseRegex, filterMatchCase } = plugin.settings;

  if (filterUseRegex) {
    const re = compileQueryRegex(plugin, query);
    if (!re) return () => null;
    // Native search ignores zero-width matches and continues to the next one.
    const scan = new RegExp(re.source, `${re.flags}g`);
    return (text) => {
      const searched = truncateForRegex(text);
      scan.lastIndex = 0;
      for (
        let match = scan.exec(searched);
        match;
        match = scan.exec(searched)
      ) {
        if (match[0].length) {
          return {
            score: 1,
            matches: [[match.index, match.index + match[0].length]],
          };
        }
        scan.lastIndex++;
      }
      return null;
    };
  }

  if (filterMatchCase) {
    return (text) => {
      const idx = text.indexOf(query);
      return idx < 0
        ? null
        : { score: 1, matches: [[idx, idx + query.length]] };
    };
  }

  return target === "content"
    ? prepareSimpleSearch(query)
    : prepareFuzzySearch(query);
}

/** One-off match; prefer createTextMatcher when testing many texts. */
export function matchAsSearchResult(
  plugin: FilterHost,
  text: string,
  query: string,
): SearchResult | null {
  return createTextMatcher(plugin, query)(text);
}

export function applyNativeResultFilters(
  view: SearchView,
  plugin: FilterHost,
): void {
  const bookmarks = plugin.settings.filterStarredOnly
    ? getBookmarkedPaths(plugin.app)
    : null;
  const { dom } = view;
  const children = dom?.vChildren?._children ?? dom?.children ?? [];

  const applyToFile = (
    file: TFile | undefined,
    el: HTMLElement | undefined,
  ) => {
    if (!file || !el) return;
    const show = isFileAllowed(plugin, file, bookmarks);
    el.style.display = show ? "" : "none";
  };

  if (children.length) {
    for (const child of children) {
      applyToFile(child.file, child.el ?? child.containerEl);
    }
    return;
  }

  view.containerEl.querySelectorAll(".search-result").forEach((node) => {
    const el = node as HTMLElement;
    const path =
      el.getAttribute("data-path") ||
      el.querySelector("[data-path]")?.getAttribute("data-path") ||
      "";
    const file = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
    if (file instanceof TFile) applyToFile(file, el);
  });
}

/** How many filters differ from their defaults (those are the ones that can hide results). */
export function activeFilterCount(settings: FilterHost["settings"]): number {
  return [
    !settings.filterIncludeBases,
    !settings.filterIncludeCanvas,
    settings.filterStarredOnly,
    settings.filterMatchCase,
    settings.filterUseRegex,
  ].filter(Boolean).length;
}

export function resetFilters(settings: FilterHost["settings"]): void {
  settings.filterIncludeBases = true;
  settings.filterIncludeCanvas = true;
  settings.filterStarredOnly = false;
  settings.filterMatchCase = false;
  settings.filterUseRegex = false;
}

export function mountFilterBar(
  anchor: HTMLElement,
  plugin: FilterHost,
  onChange: () => void,
): HTMLElement {
  const s = strings();
  let refreshMarker = () => {};
  const persist = async () => {
    await plugin.saveSettings();
    refreshMarker();
    onChange();
  };
  const row = createDiv({ cls: "pane-search-filter-row" });

  // Filters persist across sessions, so say so when any of them is hiding results.
  const addMarker = () => {
    const marker = row.createDiv({ cls: "fs-filter-active" });
    const label = marker.createSpan();
    const reset = marker.createEl("button", {
      cls: "fs-filter-reset",
      text: s.filtersReset,
      type: "button",
    });
    reset.onclick = () => {
      resetFilters(plugin.settings);
      build();
      void persist();
    };
    refreshMarker = () => {
      const count = activeFilterCount(plugin.settings);
      label.setText(s.filtersActive(count));
      marker.toggle(count > 0);
      row.toggleClass("has-active-filters", count > 0);
    };
    refreshMarker();
  };

  const build = () => {
    row.empty();

    const addCheck = (
      label: string,
      get: () => boolean,
      set: (v: boolean) => void,
    ) => {
      const wrap = row.createEl("label", { cls: "fs-filter-check" });
      const input = wrap.createEl("input", { type: "checkbox" });
      input.checked = get();
      wrap.appendText(label);
      input.addEventListener("change", () => {
        set(input.checked);
        void persist();
      });
    };

    addCheck(
      s.filterBases,
      () => plugin.settings.filterIncludeBases,
      (v) => {
        plugin.settings.filterIncludeBases = v;
      },
    );
    addCheck(
      s.filterCanvas,
      () => plugin.settings.filterIncludeCanvas,
      (v) => {
        plugin.settings.filterIncludeCanvas = v;
      },
    );

    const seg = row.createDiv({ cls: "fs-filter-seg" });
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-label", s.filterStarredOnly);
    const addSeg = (label: string, starredOnly: boolean) => {
      const btn = seg.createEl("button", { type: "button", text: label });
      if (plugin.settings.filterStarredOnly === starredOnly) {
        btn.addClass("is-active");
      }
      btn.onclick = () => {
        plugin.settings.filterStarredOnly = starredOnly;
        seg.querySelectorAll("button").forEach((b) => {
          b.removeClass("is-active");
        });
        btn.addClass("is-active");
        void persist();
      };
    };
    addSeg(s.filterAll, false);
    addSeg(s.filterStarredOnly, true);

    row.createDiv({ cls: "fs-filter-spacer" });

    const addToggleIcon = (
      label: string,
      icon: string,
      get: () => boolean,
      set: (v: boolean) => void,
    ) => {
      const btn = row.createEl("button", { cls: "fs-filter-icon" });
      btn.type = "button";
      btn.setAttribute("aria-label", label);
      btn.setAttribute("aria-pressed", get() ? "true" : "false");
      if (get()) btn.addClass("is-active");
      setIcon(btn, icon);
      btn.onclick = () => {
        const next = !get();
        set(next);
        btn.toggleClass("is-active", next);
        btn.setAttribute("aria-pressed", next ? "true" : "false");
        void persist();
      };
    };

    addToggleIcon(
      s.filterMatchCase,
      CASE_ICON,
      () => plugin.settings.filterMatchCase,
      (v) => {
        plugin.settings.filterMatchCase = v;
      },
    );
    addToggleIcon(
      s.filterRegex,
      REGEX_ICON,
      () => plugin.settings.filterUseRegex,
      (v) => {
        plugin.settings.filterUseRegex = v;
      },
    );

    addMarker();
  };
  build();

  anchor.insertAdjacentElement("afterend", row);
  return row;
}

export function watchNativeSearchResults(
  view: SearchView,
  plugin: FilterHost,
): () => void {
  const run = debounce(() => applyNativeResultFilters(view, plugin), 50, true);
  const observer = new MutationObserver(() => run());
  observer.observe(view.containerEl, {
    childList: true,
    subtree: true,
  });
  run();
  return () => {
    observer.disconnect();
    run.cancel();
  };
}
