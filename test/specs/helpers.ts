import { browser } from "@wdio/globals";

export const PLUGIN_ID = "pane-search";

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
