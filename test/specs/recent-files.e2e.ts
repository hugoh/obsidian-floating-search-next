import { browser, expect } from "@wdio/globals";
import { afterEach, beforeEach, describe, it } from "mocha";
import {
  closeModals,
  focusFirstResult,
  PLUGIN_ID,
  resetPlugin,
  searchFor,
  waitForPlugin,
  waitForResults,
} from "./helpers";

/** Shows every result in the preview pane, the way arrowing or Tab does. */
async function previewEveryResult(): Promise<string[]> {
  return browser.executeObsidian(async ({ app }, id) => {
    const { modal } = app.plugins.plugins[id];
    const previewed: string[] = [];
    for (const file of modal.searchLeaf.view.dom.resultDomLookup.keys()) {
      previewed.push(file.path);
      await modal.initFileView(file);
      app.workspace.setActiveLeaf(modal.fileLeaf as never, { focus: false });
      app.workspace.setActiveLeaf(modal.searchLeaf, { focus: false });
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return previewed;
  }, PLUGIN_ID);
}

async function closeModal() {
  await browser.executeObsidian(({ app }, id) => {
    app.plugins.plugins[id].modal.close();
  }, PLUGIN_ID);
}

const recentFiles = () =>
  browser.executeObsidian(({ app }) => app.workspace.getLastOpenFiles());

describe("Recent files", () => {
  // Each test starts with no note open and empty lists, so an earlier test's
  // open file cannot show up as a recent one.
  beforeEach(async () => {
    await waitForPlugin();
    await browser.executeObsidian(async ({ app }) => {
      app.workspace.detachLeavesOfType("markdown");
      await new Promise((resolve) => setTimeout(resolve, 150));
      app.workspace.recentFileTracker.lastOpenFiles = [];
    });
  });

  afterEach(async () => {
    await closeModals();
    await resetPlugin();
  });

  it("does not record files that were only previewed", async () => {
    await searchFor("pineapple");
    await waitForResults();
    const previewed = await previewEveryResult();
    expect(previewed.length).toBeGreaterThan(1);
    await closeModal();
    await browser.pause(300);
    expect(
      (await recentFiles()).filter((path) => previewed.includes(path)),
    ).toEqual([]);
  });

  it("records a file opened with Enter once another file replaces it", async () => {
    await searchFor("pineapple");
    await waitForResults();
    const opened = await focusFirstResult();
    await browser.keys(["Enter"]);
    await browser.waitUntil(
      async () =>
        (await browser.executeObsidian(
          ({ app }) => app.workspace.getActiveFile()?.path,
        )) === opened,
      { timeoutMsg: `${opened} was never opened` },
    );
    await browser.executeObsidian(async ({ app }) => {
      await app.workspace.openLinkText("Other", "", false);
    });
    await browser.waitUntil(
      async () => (await recentFiles()).includes(opened),
      {
        timeoutMsg: `${opened} never reached the recent files`,
      },
    );
  });

  describe("with the Recent Files plugin", () => {
    const RECENT_FILES = "recent-files-obsidian";

    const listed = () =>
      browser.executeObsidian(
        ({ app }, id) =>
          (
            app.plugins.plugins[id] as never as {
              data: { recentFiles: { path: string }[] };
            }
          ).data.recentFiles.map((entry) => entry.path),
        RECENT_FILES,
      );

    // The plugin is installed disabled (see wdio.conf.mts); it must be running
    // before the modal opens, because the modal reads it then.
    beforeEach(async () => {
      await browser.executeObsidian(async ({ app }, id) => {
        await app.plugins.enablePlugin(id);
        (
          app.plugins.plugins[id] as never as {
            data: { recentFiles: unknown[] };
          }
        ).data.recentFiles = [];
      }, RECENT_FILES);
    });

    afterEach(async () => {
      await browser.executeObsidian(async ({ app }, id) => {
        await app.plugins.disablePlugin(id);
      }, RECENT_FILES);
    });

    it("lists a file opened the normal way", async () => {
      // Opening the file that is already active fires no event, so pick another.
      const target = await browser.executeObsidian(async ({ app }) => {
        const name =
          app.workspace.getActiveFile()?.basename === "Other"
            ? "Banana"
            : "Other";
        await app.workspace.openLinkText(name, "", false);
        return app.workspace.getActiveFile()?.path ?? "";
      });
      await browser.waitUntil(async () => (await listed()).includes(target), {
        timeoutMsg: `the plugin never recorded ${target}, so it is not listening`,
      });
    });

    it("keeps previewed files out of its list", async () => {
      await searchFor("pineapple");
      await waitForResults();
      const previewed = await previewEveryResult();
      expect(previewed.length).toBeGreaterThan(1);
      await closeModal();
      await browser.pause(300);
      expect(
        (await listed()).filter((path) => previewed.includes(path)),
      ).toEqual([]);
    });

    it("still lists a file that was opened for real", async () => {
      await searchFor("pineapple");
      await waitForResults();
      const opened = await focusFirstResult();
      await browser.keys(["Enter"]);
      await browser.waitUntil(async () => (await listed()).includes(opened), {
        timeoutMsg: `${opened} never reached the plugin's list`,
      });
    });
  });
});
