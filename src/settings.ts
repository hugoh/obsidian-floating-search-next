export type SortOrder =
  | "alphabetical"
  | "alphabeticalReverse"
  | "byModifiedTime"
  | "byModifiedTimeReverse"
  | "byCreatedTime"
  | "byCreatedTimeReverse";

export interface SearchState extends Record<string, unknown> {
  collapseAll?: boolean;
  explainSearch?: boolean;
  extraContext?: boolean;
  matchingCase?: boolean;
  query: string;
  sortOrder?: SortOrder;
}

export interface PaneSearchSettings {
  searchViewState: SearchState;
  showFilePath: boolean;
  showInstructions: boolean;
}

const SORT_ORDERS: readonly SortOrder[] = [
  "alphabetical",
  "alphabeticalReverse",
  "byModifiedTime",
  "byModifiedTimeReverse",
  "byCreatedTime",
  "byCreatedTimeReverse",
];

export const DEFAULT_SETTINGS: PaneSearchSettings = {
  searchViewState: {
    collapseAll: false,
    explainSearch: false,
    extraContext: false,
    matchingCase: false,
    query: "",
    sortOrder: "alphabetical",
  },
  showFilePath: false,
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
    collapseAll: bool(state.collapseAll, defaults.collapseAll ?? false),
    explainSearch: bool(state.explainSearch, defaults.explainSearch ?? false),
    extraContext: bool(state.extraContext, defaults.extraContext ?? false),
    matchingCase: bool(state.matchingCase, defaults.matchingCase ?? false),
    // Never restore a saved query: searches open empty, and queries may be private.
    query: "",
    sortOrder: oneOf(
      state.sortOrder,
      SORT_ORDERS,
      defaults.sortOrder ?? "alphabetical",
    ),
  };
}

/** Turns whatever data.json held into valid settings; never throws. */
export function sanitizeSettings(raw: unknown): PaneSearchSettings {
  const data = isRecord(raw) ? raw : {};
  const d = DEFAULT_SETTINGS;
  return {
    searchViewState: sanitizeViewState(data.searchViewState),
    showFilePath: bool(data.showFilePath, d.showFilePath),
    showInstructions: bool(data.showInstructions, d.showInstructions),
  };
}
