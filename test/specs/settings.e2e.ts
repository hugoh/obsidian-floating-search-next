import { browser, expect } from "@wdio/globals";
import { afterEach, describe, it } from "mocha";
import { closeModals, PLUGIN_ID, waitForPlugin } from "./helpers";

async function reloadPlugin() {
  await browser.executeObsidian(async ({ app }, id) => {
    await app.plugins.disablePlugin(id);
    await app.plugins.enablePlugin(id);
  }, PLUGIN_ID);
  await waitForPlugin();
}

describe("Settings", () => {
  afterEach(async () => {
    await browser.executeObsidian(async ({ app }, id) => {
      await app.plugins.plugins[id].saveData({});
    }, PLUGIN_ID);
    await reloadPlugin();
  });

  it("persists the very first change", async () => {
    await waitForPlugin();
    await browser.executeObsidian(({ app }, id) => {
      const plugin = app.plugins.plugins[id];
      plugin.settings.showInstructions = false;
      plugin.applySettingsUpdate();
    }, PLUGIN_ID);

    await browser.waitUntil(
      async () =>
        browser.executeObsidian(async ({ app }, id) => {
          const saved = await app.plugins.plugins[id].loadData();
          return saved?.showInstructions === false;
        }, PLUGIN_ID),
      {
        timeout: 5000,
        timeoutMsg: "the first settings change was never saved",
      },
    );
  });

  it("saves a pending change when the plugin is unloaded straight away", async () => {
    await waitForPlugin();
    await browser.executeObsidian(async ({ app }, id) => {
      const plugin = app.plugins.plugins[id];
      plugin.settings.showInstructions = false;
      plugin.applySettingsUpdate();
      await app.plugins.disablePlugin(id);
      await app.plugins.enablePlugin(id);
    }, PLUGIN_ID);
    await waitForPlugin();
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(
          ({ app }, id) =>
            app.plugins.plugins[id].settings.showInstructions === false,
          PLUGIN_ID,
        ),
      {
        timeout: 5000,
        timeoutMsg: "the change made just before unloading was lost",
      },
    );
  });

  it("recovers from invalid saved settings instead of failing to load", async () => {
    await browser.executeObsidian(async ({ app }, id) => {
      await app.plugins.plugins[id].saveData({
        showInstructions: 3,
        defaultViewType: "hologram",
        savedSearches: [null],
      });
    }, PLUGIN_ID);
    await reloadPlugin();

    const settings = await browser.executeObsidian(
      ({ app }, id) => app.plugins.plugins[id].settings,
      PLUGIN_ID,
    );
    expect(settings.showFilePath).toBeUndefined();
    expect(settings.showInstructions).toBe(true);
    expect(settings.defaultViewType).toBeUndefined();
    expect(settings.savedSearches).toBeUndefined();
  });
});

describe("obsidian://fs", () => {
  afterEach(async () => {
    await closeModals();
  });

  it("opens the modal with the query from the link", async function () {
    await waitForPlugin();
    // Older Obsidian versions keep protocol handlers elsewhere.
    const supported = await browser.executeObsidian(({ app }) =>
      Boolean(app.workspace.protocolHandler),
    );
    if (!supported) this.skip();
    await browser.executeObsidian(({ app }) => {
      app.workspace.protocolHandler.handlers.get("fs")?.({
        action: "fs",
        query: "pineapple",
      });
    });
    const input = browser.$(".pane-search-modal .search-input-container input");
    await input.waitForExist({ timeout: 10_000 });
    await browser.waitUntil(
      async () => (await input.getValue()) === "pineapple",
    );
  });
});
