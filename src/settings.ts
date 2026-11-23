import type { PaneType } from "obsidian";

export type SortOrder =
  | "alphabetical"
  | "alphabeticalReverse"
  | "byModifiedTime"
  | "byModifiedTimeReverse"
  | "byCreatedTime"
  | "byCreatedTimeReverse";

export type SearchType = "modal" | "sidebar" | PaneType;

export type CmdkTriggerKey = "Shift" | "Control" | "Alt" | "Meta" | "none";

export interface SearchState extends Record<string, unknown> {
  collapseAll?: boolean;
  explainSearch?: boolean;
  extraContext?: boolean;
  matchingCase?: boolean;
  query: string;
  sortOrder?: SortOrder;
  current?: boolean;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
}

export interface PaneSearchSettings {
  searchViewState: SearchState;
  showFilePath: boolean;
  showInstructions: boolean;
  defaultViewType: SearchType;
  cmdkTriggerKey: CmdkTriggerKey;
  cmdkDoubleTapInterval: number;
  cmdkAutoPreview: boolean;
  cmdkQuickCreate: boolean;
  cmdkQuickCreateFolder: string;
  cmdkQuickCreateTitleFormat: string;
  filterIncludeBases: boolean;
  filterIncludeCanvas: boolean;
  filterStarredOnly: boolean;
  filterMatchCase: boolean;
  filterUseRegex: boolean;
  excludeFolders: string[];
  excludeFiles: string[];
  savedSearches: SavedSearch[];
}

export const SEARCH_TYPES: readonly SearchType[] = [
  "modal",
  "sidebar",
  "split",
  "tab",
  "window",
];
const TRIGGER_KEYS: readonly CmdkTriggerKey[] = [
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "none",
];
const SORT_ORDERS: readonly SortOrder[] = [
  "alphabetical",
  "alphabeticalReverse",
  "byModifiedTime",
  "byModifiedTimeReverse",
  "byCreatedTime",
  "byCreatedTimeReverse",
];

export const DOUBLE_TAP_RANGE = { min: 150, max: 600 } as const;

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
  defaultViewType: "modal",
  cmdkTriggerKey: "Shift",
  cmdkDoubleTapInterval: 300,
  cmdkAutoPreview: true,
  cmdkQuickCreate: false,
  cmdkQuickCreateFolder: "",
  cmdkQuickCreateTitleFormat: "YYYYMMDDHHmmss",
  filterIncludeBases: true,
  filterIncludeCanvas: true,
  filterStarredOnly: false,
  filterMatchCase: false,
  filterUseRegex: false,
  excludeFolders: [],
  excludeFiles: [],
  savedSearches: [],
};

/** A view type from untrusted input (a URI, saved data), or undefined. */
export function parseViewType(raw: unknown): SearchType | undefined {
  return SEARCH_TYPES.find((type) => type === raw);
}

export function newSavedSearchId(): string {
  return crypto.randomUUID();
}

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const bool = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;
const text = (value: unknown, fallback: string) =>
  typeof value === "string" ? value : fallback;
const oneOf = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T => allowed.find((item) => item === value) ?? fallback;
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

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

function sanitizeSavedSearches(raw: unknown): SavedSearch[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: SavedSearch[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const name = text(entry.name, "").trim();
    const query = text(entry.query, "").trim();
    if (!name || !query) continue;
    let id = text(entry.id, "");
    if (!id || seen.has(id)) id = newSavedSearchId();
    seen.add(id);
    result.push({ id, name, query });
  }
  return result;
}

/** Turns whatever data.json held into valid settings; never throws. */
export function sanitizeSettings(raw: unknown): PaneSearchSettings {
  const data = isRecord(raw) ? raw : {};
  const d = DEFAULT_SETTINGS;
  return {
    searchViewState: sanitizeViewState(data.searchViewState),
    showFilePath: bool(data.showFilePath, d.showFilePath),
    showInstructions: bool(data.showInstructions, d.showInstructions),
    defaultViewType: oneOf(
      data.defaultViewType,
      SEARCH_TYPES,
      d.defaultViewType,
    ),
    cmdkTriggerKey: oneOf(data.cmdkTriggerKey, TRIGGER_KEYS, d.cmdkTriggerKey),
    cmdkDoubleTapInterval:
      typeof data.cmdkDoubleTapInterval === "number" &&
      Number.isFinite(data.cmdkDoubleTapInterval)
        ? Math.min(
            DOUBLE_TAP_RANGE.max,
            Math.max(DOUBLE_TAP_RANGE.min, data.cmdkDoubleTapInterval),
          )
        : d.cmdkDoubleTapInterval,
    cmdkAutoPreview: bool(data.cmdkAutoPreview, d.cmdkAutoPreview),
    cmdkQuickCreate: bool(data.cmdkQuickCreate, d.cmdkQuickCreate),
    cmdkQuickCreateFolder: text(
      data.cmdkQuickCreateFolder,
      d.cmdkQuickCreateFolder,
    ),
    cmdkQuickCreateTitleFormat: text(
      data.cmdkQuickCreateTitleFormat,
      d.cmdkQuickCreateTitleFormat,
    ),
    filterIncludeBases: bool(data.filterIncludeBases, d.filterIncludeBases),
    filterIncludeCanvas: bool(data.filterIncludeCanvas, d.filterIncludeCanvas),
    filterStarredOnly: bool(data.filterStarredOnly, d.filterStarredOnly),
    filterMatchCase: bool(data.filterMatchCase, d.filterMatchCase),
    filterUseRegex: bool(data.filterUseRegex, d.filterUseRegex),
    excludeFolders: strings(data.excludeFolders),
    excludeFiles: strings(data.excludeFiles),
    savedSearches: sanitizeSavedSearches(data.savedSearches),
  };
}
