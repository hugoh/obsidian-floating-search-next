import { browser, expect } from "@wdio/globals";
import { afterEach, describe, it } from "mocha";
import { closeModals, PLUGIN_ID, waitForPlugin } from "./helpers";

const TITLES = ".pane-search-modal .search-result-file-title";

async function waitForResults() {
  await browser.waitUntil(async () => (await browser.$$(TITLES)).length > 0, {
    timeout: 15_000,
    timeoutMsg: "the search returned no results",
  });
}

describe("Pane native search", () => {
  afterEach(async () => {
    await closeModals();
  });

  async function searchFor(query: string) {
    await waitForPlugin();
    await browser.executeObsidianCommand(
      `${PLUGIN_ID}:search-obsidian-globally`,
    );
    const input = browser.$(".pane-search-modal .search-input-container input");
    await input.waitForExist();
    await browser.waitUntil(() => input.isFocused(), {
      timeoutMsg: "the search input never received focus",
    });
    await browser.keys(query.split(""));
  }

  it("runs Obsidian's search in a modal", async () => {
    await searchFor("pineapple");
    await waitForResults();
    const titles = await browser.$$(TITLES);
    expect(titles.length).toBeGreaterThan(1);
  });

  it("does not write the search text to disk", async () => {
    await searchFor("topsecretneedle");
    await closeModals();
    await browser.executeObsidian(({ app }, id) => {
      app.plugins.plugins[id].applySettingsUpdate();
    }, PLUGIN_ID);
    await browser.pause(1800);
    const saved = await browser.executeObsidian(
      async ({ app }, id) =>
        JSON.stringify(await app.plugins.plugins[id].loadData()),
      PLUGIN_ID,
    );
    expect(saved).not.toContain("topsecretneedle");
  });
});
