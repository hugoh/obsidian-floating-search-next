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
  beforeEach(async () => {
    await waitForPlugin();
    await browser.executeObsidian(({ app }) => {
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
    const added = () =>
      browser.executeObsidian(
        ({ app }) =>
          (
            app.plugins.plugins["recent-files-obsidian"] as never as {
              added: string[];
            }
          ).added,
      );

    // Stands in for the real plugin, which is not part of the test vault: it
    // adds a file on `file-open` when its `shouldAddFile` agrees.
    beforeEach(async () => {
      await browser.executeObsidian(({ app }) => {
        const stub = {
          added: [] as string[],
          shouldAddFile: (_file: unknown) => true,
        };
        (app.plugins.plugins as Record<string, unknown>)[
          "recent-files-obsidian"
        ] = stub;
        const ref = app.workspace.on("file-open", (file) => {
          if (file && stub.shouldAddFile(file)) stub.added.push(file.path);
        });
        (window as unknown as { stubRef: unknown }).stubRef = ref;
      });
    });

    afterEach(async () => {
      await browser.executeObsidian(({ app }) => {
        delete (app.plugins.plugins as Record<string, unknown>)[
          "recent-files-obsidian"
        ];
        const { stubRef } = window as unknown as { stubRef: never };
        app.workspace.offref(stubRef);
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
        (await added()).filter((path) => previewed.includes(path)),
      ).toEqual([]);
    });

    it("still lists a file that was opened for real", async () => {
      await searchFor("pineapple");
      await waitForResults();
      const opened = await focusFirstResult();
      await browser.keys(["Enter"]);
      await browser.waitUntil(async () => (await added()).includes(opened), {
        timeoutMsg: `${opened} never reached the plugin's list`,
      });
    });
  });
});
