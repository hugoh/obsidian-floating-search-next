import { browser, expect } from "@wdio/globals";
import { afterEach, describe, it } from "mocha";
import { closeModals, PLUGIN_ID, resetPlugin, waitForPlugin } from "./helpers";

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
    await resetPlugin();
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
    await browser.executeObsidian(({ app }, id) => {
      app.plugins.plugins[id].modal.close();
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

  it("previews the focused result beside the search", async () => {
    await searchFor("pineapple");
    await waitForResults();
    await browser.keys(["ArrowDown", "Tab"]);
    await browser
      .$(".pane-search-modal .pane-search-modal-file-ctn")
      .waitForExist({ timeoutMsg: "no preview pane appeared" });
  });

  it("remembers the sort order chosen in the modal", async () => {
    await waitForPlugin();
    await browser.executeObsidianCommand(
      `${PLUGIN_ID}:search-obsidian-globally`,
    );
    await browser
      .$(".pane-search-modal .search-input-container input")
      .waitForExist();
    await browser.executeObsidian(({ app }, id) => {
      app.plugins.plugins[id].modal.searchLeaf.view.setSortOrder(
        "byModifiedTime",
      );
    }, PLUGIN_ID);
    await browser.executeObsidian(({ app }, id) => {
      app.plugins.plugins[id].modal.close();
    }, PLUGIN_ID);
    const sortOrder = await browser.executeObsidian(
      ({ app }, id) =>
        app.plugins.plugins[id].settings.searchViewState.sortOrder,
      PLUGIN_ID,
    );
    expect(sortOrder).toBe("byModifiedTime");
  });

  it("sorts by relevance by default", async () => {
    await waitForPlugin();
    await browser.executeObsidianCommand(
      `${PLUGIN_ID}:search-obsidian-globally`,
    );
    await browser
      .$(".pane-search-modal .search-input-container input")
      .waitForExist();
    const sortOrder = await browser.executeObsidian(
      ({ app }, id) =>
        app.plugins.plugins[id].modal.searchLeaf.view.getState().sortOrder,
      PLUGIN_ID,
    );
    expect(sortOrder).toBe("byRelevance");
  });

  it("opens the focused result and closes the modal on Enter", async () => {
    await searchFor("pineapple");
    await waitForResults();
    await browser.keys(["ArrowDown"]);
    await browser.pause(300);
    await browser.keys(["Enter"]);
    await browser.waitUntil(
      async () =>
        (await browser.executeObsidian(
          ({ app }) => app.workspace.getActiveFile()?.basename,
        )) === "Pineapple",
      { timeoutMsg: "Enter did not open the Pineapple note" },
    );
    await browser
      .$(".pane-search-modal")
      .waitForExist({ reverse: true, timeoutMsg: "the modal stayed open" });
  });

  it("opens the focused result in a new tab on Mod+Enter", async () => {
    await waitForPlugin();
    await browser.executeObsidian(async ({ app }) => {
      await app.workspace.openLinkText("Other", "", false);
    });
    await searchFor("pineapple");
    await waitForResults();
    await browser.keys(["ArrowDown"]);
    await browser.pause(300);
    const before = await browser.executeObsidian(
      ({ app }) => app.workspace.getLeavesOfType("markdown").length,
    );
    await browser.execute((selector) => {
      document.querySelector<HTMLInputElement>(selector)?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, ".pane-search-modal .search-input-container input");
    await browser.waitUntil(
      async () =>
        (await browser.executeObsidian(
          ({ app }) => app.workspace.getLeavesOfType("markdown").length,
        )) > before,
      { timeoutMsg: "Mod+Enter did not open a new tab" },
    );
  });
});
