import { browser, expect } from "@wdio/globals";
import { afterEach, describe, it } from "mocha";
import {
  closeModals,
  hasResult,
  openCmdk,
  PLUGIN_ID,
  updateSettings,
  waitForPlugin,
  waitForResult,
} from "./helpers";

describe("Saved searches", () => {
  afterEach(async () => {
    await closeModals();
    await updateSettings({
      savedSearches: [],
      excludeFolders: [],
      excludeFiles: [],
    });
  });

  it("registers a command that opens quick search pre-filtered", async () => {
    await waitForPlugin();
    const presetId = await browser.executeObsidian(async ({ app }, id) => {
      const plugin = app.plugins.plugins[id];
      await plugin.addSavedSearch("Fruit notes", "path:Notes");
      return plugin.settings.savedSearches.at(-1)?.id ?? "";
    }, PLUGIN_ID);

    await browser.executeObsidianCommand(
      `${PLUGIN_ID}:savedsearch-${presetId}`,
    );
    await browser.$(".pane-search-cmdk").waitForExist();
    await waitForResult("Banana");
    expect(await hasResult("Pineapple")).toBe(false);
  });

  it("lists presets as filter chips that narrow the results", async () => {
    await updateSettings({
      savedSearches: [{ name: "Archive", query: "path:Archive" }],
    });
    await openCmdk();
    const chip = browser.$(".pane-search-filter-chip=Archive");
    await chip.waitForExist();
    await chip.click();
    await waitForResult("Old");
    expect(await hasResult("Pineapple")).toBe(false);
  });
});
