import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, sanitizeSettings } from "./settings";

describe("sanitizeSettings", () => {
  test.each([[null], [undefined], [42], ["text"], [[]]])(
    "falls back to the defaults for %p",
    (raw) => {
      expect(sanitizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
    },
  );

  test("keeps valid values", () => {
    expect(
      sanitizeSettings({ showFilePath: true, showInstructions: false }),
    ).toMatchObject({ showFilePath: true, showInstructions: false });
  });

  test("replaces values of the wrong type", () => {
    const settings = sanitizeSettings({
      showFilePath: "yes",
      showInstructions: 0,
    });
    expect(settings.showFilePath).toBe(DEFAULT_SETTINGS.showFilePath);
    expect(settings.showInstructions).toBe(DEFAULT_SETTINGS.showInstructions);
  });

  test("drops settings of features that no longer exist", () => {
    const settings = sanitizeSettings({
      showFilePath: true,
      defaultViewType: "tab",
      cmdkTriggerKey: "Alt",
      excludeFolders: ["Archive"],
      savedSearches: [{ id: "1", name: "n", query: "q" }],
      filterUseRegex: true,
    });
    expect(Object.keys(settings).sort()).toEqual(
      Object.keys(DEFAULT_SETTINGS).sort(),
    );
    expect(settings.showFilePath).toBe(true);
  });

  test("never restores a saved query, whatever data.json holds", () => {
    expect(
      sanitizeSettings({ searchViewState: { query: "secret" } }).searchViewState
        .query,
    ).toBe("");
  });

  test("merges the saved search view state with its defaults", () => {
    const settings = sanitizeSettings({
      searchViewState: { collapseAll: true, sortOrder: "nonsense", query: 5 },
    });
    expect(settings.searchViewState.collapseAll).toBe(true);
    expect(settings.searchViewState.sortOrder).toBe(
      DEFAULT_SETTINGS.searchViewState.sortOrder,
    );
    expect(settings.searchViewState.query).toBe("");
  });
});
