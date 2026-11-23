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

export async function openCmdk(initialFilters?: string[]) {
  await waitForPlugin();
  await browser.executeObsidian(
    ({ app }, id, filters) => {
      const plugin = app.plugins.plugins[id];
      plugin.openCmdkModal(filters);
    },
    PLUGIN_ID,
    initialFilters,
  );
  const input = browser.$(".pane-search-cmdk .prompt-input");
  await input.waitForExist();
  return input;
}

export async function updateSettings(patch: Record<string, unknown>) {
  await waitForPlugin();
  await browser.executeObsidian(
    ({ app }, id, values) => {
      const plugin = app.plugins.plugins[id];
      Object.assign(plugin.settings, values);
    },
    PLUGIN_ID,
    patch,
  );
}

export async function resultTexts(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        ".pane-search-cmdk .suggestion-item",
      ),
      (item) => item.innerText,
    ),
  );
}

export async function hasResult(text: string): Promise<boolean> {
  return (await resultTexts()).some((row) => row.includes(text));
}

export async function waitForResult(text: string) {
  await browser.waitUntil(() => hasResult(text), {
    timeoutMsg: `"${text}" never appeared in the results`,
  });
}

export async function activePath(): Promise<string | undefined> {
  return browser.executeObsidian(
    ({ app }) => app.workspace.getActiveFile()?.path,
  );
}

export async function closeModals() {
  await browser.keys("Escape");
}
