export type SortOrder =
  | "byRelevance"
  | "alphabetical"
  | "alphabeticalReverse"
  | "byModifiedTime"
  | "byModifiedTimeReverse"
  | "byCreatedTime"
  | "byCreatedTimeReverse";

/**
 * The keys of Obsidian's own search view state that are kept between searches.
 * They are handed to the search view as-is, which is why the plugin itself never
 * reads most of them.
 */
export interface SearchState extends Record<string, unknown> {
  collapseAll: boolean;
  explainSearch: boolean;
  extraContext: boolean;
  matchingCase: boolean;
  query: string;
  sortOrder: SortOrder;
}

export interface SearchOpenSettings {
  searchViewState: SearchState;
  showInstructions: boolean;
}

const SORT_ORDERS: readonly SortOrder[] = [
  "byRelevance",
  "alphabetical",
  "alphabeticalReverse",
  "byModifiedTime",
  "byModifiedTimeReverse",
  "byCreatedTime",
  "byCreatedTimeReverse",
];

export const DEFAULT_SETTINGS: SearchOpenSettings = {
  searchViewState: {
    collapseAll: false,
    explainSearch: false,
    extraContext: false,
    matchingCase: false,
    query: "",
    sortOrder: "byRelevance",
  },
  showInstructions: true,
};

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const bool = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;
const oneOf = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T => allowed.find((item) => item === value) ?? fallback;

function sanitizeViewState(raw: unknown): SearchState {
  const defaults = DEFAULT_SETTINGS.searchViewState;
  const state = isRecord(raw) ? raw : {};
  return {
    collapseAll: bool(state.collapseAll, defaults.collapseAll),
    explainSearch: bool(state.explainSearch, defaults.explainSearch),
    extraContext: bool(state.extraContext, defaults.extraContext),
    matchingCase: bool(state.matchingCase, defaults.matchingCase),
    // Never restore a saved query: searches open empty, and queries may be private.
    query: "",
    sortOrder: oneOf(state.sortOrder, SORT_ORDERS, defaults.sortOrder),
  };
}

/** Turns whatever data.json held into valid settings; never throws. */
export function sanitizeSettings(raw: unknown): SearchOpenSettings {
  const data = isRecord(raw) ? raw : {};
  return {
    searchViewState: sanitizeViewState(data.searchViewState),
    showInstructions: bool(
      data.showInstructions,
      DEFAULT_SETTINGS.showInstructions,
    ),
  };
}
