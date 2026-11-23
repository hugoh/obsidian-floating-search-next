import { browser, expect } from "@wdio/globals";
import { afterEach, describe, it } from "mocha";
import {
  closeModals,
  PLUGIN_ID,
  updateSettings,
  waitForPlugin,
} from "./helpers";

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
        defaultViewType: "hologram",
        excludeFolders: "not-a-list",
        savedSearches: [null, { name: "", query: "x" }],
        cmdkDoubleTapInterval: "fast",
      });
    }, PLUGIN_ID);
    await reloadPlugin();

    const settings = await browser.executeObsidian(
      ({ app }, id) => app.plugins.plugins[id].settings,
      PLUGIN_ID,
    );
    expect(settings.defaultViewType).toBe("modal");
    expect(settings.excludeFolders).toEqual([]);
    expect(settings.savedSearches).toEqual([]);
    expect(settings.cmdkDoubleTapInterval).toBe(300);
  });
});

describe("Saved search commands", () => {
  afterEach(async () => {
    await closeModals();
    await updateSettings({ savedSearches: [] });
  });

  const commandIds = () =>
    browser.executeObsidian(
      ({ app }, id) =>
        Object.keys(app.commands.commands).filter((c) =>
          c.startsWith(`${id}:savedsearch-`),
        ),
      PLUGIN_ID,
    );

  it("gives every preset its own command, whatever script its name is in", async () => {
    await waitForPlugin();
    const before = (await commandIds()).length;
    await browser.executeObsidian(async ({ app }, id) => {
      const plugin = app.plugins.plugins[id];
      await plugin.addSavedSearch("项目", "path:Archive");
      await plugin.addSavedSearch("笔记", "path:Notes");
    }, PLUGIN_ID);
    expect((await commandIds()).length).toBe(before + 2);
  });

  it("removes the command when its preset is deleted", async () => {
    await waitForPlugin();
    await browser.executeObsidian(async ({ app }, id) => {
      await app.plugins.plugins[id].addSavedSearch("Temp", "path:Notes");
    }, PLUGIN_ID);
    const withPreset = (await commandIds()).length;
    await browser.executeObsidian(({ app }, id) => {
      const plugin = app.plugins.plugins[id];
      plugin.settings.savedSearches.splice(0);
      plugin.syncSavedSearchCommands();
    }, PLUGIN_ID);
    expect((await commandIds()).length).toBe(withPreset - 1);
  });
});

describe("obsidian://fs", () => {
  afterEach(async () => {
    await closeModals();
  });

  it("falls back to the modal for an unknown viewType", async function () {
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
        viewType: "hologram",
      });
    });
    await browser.$(".pane-search-modal").waitForExist({ timeout: 10_000 });
  });
});
