import { browser, expect } from "@wdio/globals";
import { afterEach, describe, it } from "mocha";
import {
  closeModals,
  PLUGIN_ID,
  updateSettings,
  waitForPlugin,
} from "./helpers";

const TITLES = ".pane-search-modal .search-result-file-title";

async function waitForResults() {
  await browser.waitUntil(async () => (await browser.$$(TITLES)).length > 0, {
    timeout: 15_000,
    timeoutMsg: "the search returned no results",
  });
}

const SEARCH_INPUT = ".pane-search-modal .search-input-container input";

async function nativeTitles(): Promise<string[]> {
  return browser.execute(
    (selector) =>
      Array.from(
        document.querySelectorAll<HTMLElement>(selector),
        (el) => el.innerText.split("\n")[0] ?? "",
      ),
    TITLES,
  );
}

async function nudgeSearch() {
  await browser.execute((selector) => {
    document
      .querySelector<HTMLInputElement>(selector)
      ?.dispatchEvent(new Event("input", { bubbles: true }));
  }, SEARCH_INPUT);
}

describe("Pane native search", () => {
  afterEach(async () => {
    await closeModals();
    await updateSettings({ excludeFolders: [], excludeFiles: [] });
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
    // Type into the focused field, like a user, so the injected exclusion clause survives.
    await browser.keys(query.split(""));
  }

  it("runs Obsidian's search in a modal", async () => {
    await searchFor("pineapple");
    await waitForResults();
    const titles = await browser.$$(TITLES);
    expect(titles.length).toBeGreaterThan(1);
  });

  it("keeps text typed into an empty search separate from the exclusion clause", async () => {
    await updateSettings({ excludeFolders: ["Archive"] });
    await searchFor("pineapple");
    const input = browser.$(".pane-search-modal .search-input-container input");
    expect(await input.getValue()).toBe("pineapple -path:/^Archive\\//");
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

  it("names a note from the search text without link characters (Mod+Shift+Enter)", async () => {
    await searchFor("my#idea^x");
    // "Mod" is Cmd on macOS and Ctrl elsewhere.
    await browser.keys([
      process.platform === "darwin" ? "Meta" : "Control",
      "Shift",
      "Enter",
    ]);
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(
          ({ app }) => app.workspace.getActiveFile()?.path === "my-idea-x.md",
        ),
      { timeoutMsg: "the note my-idea-x.md was not opened" },
    );
  });

  it("applies exclusion rules to the native search", async () => {
    await updateSettings({ excludeFolders: ["Archive"] });
    await searchFor("pineapple");
    let texts: string[] = [];
    // The list re-renders as results stream in, so read it in one atomic DOM pass.
    // If the first search came back empty, nudge it with another input event.
    await browser.waitUntil(
      async () => {
        texts = await nativeTitles();
        if (texts.length === 0) await nudgeSearch();
        return texts.includes("Pineapple");
      },
      {
        timeoutMsg: `the native search never listed Pineapple; saw ${JSON.stringify(texts)} for input ${JSON.stringify(await browser.$(".pane-search-modal .search-input-container input").getValue())}`,
      },
    );
    expect(texts).not.toContain("Old");
  });
});
