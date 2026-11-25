import { browser } from "@wdio/globals";

export const PLUGIN_ID = "search-open";

export async function waitForPlugin() {
  await browser.waitUntil(
    async () =>
      browser.executeObsidian(({ app }, id) => {
        const plugin = app.plugins.plugins[id];
        return Boolean(plugin?.settings);
      }, PLUGIN_ID),
    { timeoutMsg: "the plugin never finished loading" },
  );
  await waitForVaultIndexed();
}

// Searching before Obsidian has indexed the vault yields an empty list that never refreshes.
export async function waitForVaultIndexed() {
  await browser.waitUntil(
    async () =>
      browser.executeObsidian(({ app }) => {
        const files = app.vault.getMarkdownFiles();
        return (
          app.workspace.layoutReady &&
          files.length > 0 &&
          files.every((file) => app.metadataCache.getFileCache(file))
        );
      }),
    {
      timeout: 30_000,
      timeoutMsg: "Obsidian never finished indexing the vault",
    },
  );
}

export async function closeModals() {
  await browser.keys("Escape");
}

export async function resetPlugin() {
  await browser.executeObsidian(async ({ app }, id) => {
    await app.plugins.disablePlugin(id);
    // Unloading saves pending settings, so wipe them only afterwards.
    await app.vault.adapter.write(
      `${app.vault.configDir}/plugins/${id}/data.json`,
      "{}",
    );
    await app.plugins.enablePlugin(id);
  }, PLUGIN_ID);
  await waitForPlugin();
}

const TITLES = ".search-open-modal .search-result-file-title";

export async function waitForResults() {
  await browser.waitUntil(async () => (await browser.$$(TITLES)).length > 0, {
    timeout: 15_000,
    timeoutMsg: "the search returned no results",
  });
}

/** Opens the global search and types a query into it. */
export async function searchFor(query: string) {
  await waitForPlugin();
  await browser.executeObsidianCommand(`${PLUGIN_ID}:search-obsidian-globally`);
  const input = browser.$(".search-open-modal .search-input-container input");
  await input.waitForExist();
  await browser.waitUntil(() => input.isFocused(), {
    timeoutMsg: "the search input never received focus",
  });
  await browser.keys(query.split(""));
}

/** Moves to the first result and returns the path of the file it stands for. */
export async function focusFirstResult(): Promise<string> {
  await browser.keys(["ArrowDown"]);
  let focused: string | undefined;
  await browser.waitUntil(
    async () => {
      focused = await browser.executeObsidian(
        ({ app }, id) =>
          app.plugins.plugins[id].modal.searchLeaf.view.dom.focusedItem?.file
            ?.path,
        PLUGIN_ID,
      );
      return focused !== undefined;
    },
    { timeoutMsg: "no result received focus" },
  );
  return focused as string;
}

/** Sends a key straight to the search input, whatever has focus. */
export async function pressInSearchInput(init: KeyboardEventInit) {
  await browser.execute(
    (selector, eventInit) => {
      document.querySelector<HTMLInputElement>(selector)?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ...eventInit,
        }),
      );
    },
    ".search-open-modal .search-input-container input",
    init,
  );
}
