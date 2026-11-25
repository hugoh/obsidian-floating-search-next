import { browser, expect } from "@wdio/globals";
import { afterEach, describe, it } from "mocha";
import {
  closeModals,
  focusFirstResult,
  PLUGIN_ID,
  pressInSearchInput,
  resetPlugin,
  searchFor,
  waitForPlugin,
  waitForResults,
} from "./helpers";

const TITLES = ".search-open-modal .search-result-file-title";

describe("Search & Open modal", () => {
  afterEach(async () => {
    await closeModals();
    await resetPlugin();
  });

  it("runs Obsidian's search in a modal", async () => {
    await searchFor("pineapple");
    await waitForResults();
    const titles = await browser.$$(TITLES);
    expect(titles.length).toBeGreaterThan(1);
  });

  it("does not write the search text to disk", async () => {
    await searchFor("topsecretneedle");
    await browser.executeObsidian(({ app }, id) => {
      const plugin = app.plugins.plugins[id];
      plugin.modal.close();
      plugin.applySettingsUpdate.run();
    }, PLUGIN_ID);
    const loadSaved = () =>
      browser.executeObsidian(
        async ({ app }, id) =>
          JSON.stringify(await app.plugins.plugins[id].loadData()),
        PLUGIN_ID,
      );
    await browser.waitUntil(
      async () => (await loadSaved()).includes("searchViewState"),
      { timeoutMsg: "the settings were never saved" },
    );
    expect(await loadSaved()).not.toContain("topsecretneedle");
  });

  it("previews the focused result beside the search", async () => {
    await searchFor("pineapple");
    await waitForResults();
    await browser.keys(["ArrowDown", "Tab"]);
    await browser
      .$(".search-open-modal .search-open-modal-file-ctn")
      .waitForExist({ timeoutMsg: "no preview pane appeared" });
  });

  it("remembers the sort order chosen in the modal", async () => {
    await waitForPlugin();
    await browser.executeObsidianCommand(
      `${PLUGIN_ID}:search-obsidian-globally`,
    );
    await browser
      .$(".search-open-modal .search-input-container input")
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
      .$(".search-open-modal .search-input-container input")
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
    const focusedPath = await focusFirstResult();
    const activePath = () =>
      browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path);
    expect(await activePath()).not.toBe(focusedPath);
    await browser.keys(["Enter"]);
    await browser.waitUntil(async () => (await activePath()) === focusedPath, {
      timeoutMsg: `Enter did not open ${focusedPath}`,
    });
    await browser
      .$(".search-open-modal")
      .waitForExist({ reverse: true, timeoutMsg: "the modal stayed open" });
  });

  it("opens the focused result in a new tab on Mod+Enter", async () => {
    await waitForPlugin();
    await browser.executeObsidian(async ({ app }) => {
      await app.workspace.openLinkText("Other", "", false);
    });
    await searchFor("pineapple");
    await waitForResults();
    await focusFirstResult();
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
    }, ".search-open-modal .search-input-container input");
    await browser.waitUntil(
      async () =>
        (await browser.executeObsidian(
          ({ app }) => app.workspace.getLeavesOfType("markdown").length,
        )) > before,
      { timeoutMsg: "Mod+Enter did not open a new tab" },
    );
    expect(await browser.$(".search-open-modal").isExisting()).toBe(true);
  });

  describe("while the preview is the active leaf", () => {
    // Obsidian can still count the preview as active when a key arrives; the
    // result must open in the workspace, not inside the preview.
    async function previewBecomesActive(): Promise<string> {
      await searchFor("pineapple");
      await waitForResults();
      const focusedPath = await focusFirstResult();
      await browser
        .$(".search-open-modal .search-open-modal-file-ctn")
        .waitForExist({ timeoutMsg: "no preview pane appeared" });
      await browser.executeObsidian(({ app }, id) => {
        const { modal } = app.plugins.plugins[id];
        app.workspace.setActiveLeaf(modal.fileLeaf as never, { focus: false });
      }, PLUGIN_ID);
      return focusedPath;
    }

    it("opens the result in the workspace on Enter", async () => {
      const focusedPath = await previewBecomesActive();
      await pressInSearchInput({ key: "Enter" });
      await browser.waitUntil(
        async () =>
          (await browser.executeObsidian(
            ({ app }) => app.workspace.getActiveFile()?.path,
          )) === focusedPath,
        { timeoutMsg: `Enter did not open ${focusedPath} in the workspace` },
      );
    });

    it("opens the result in a new tab on Mod+Enter", async () => {
      await browser.executeObsidian(async ({ app }) => {
        await app.workspace.openLinkText("Other", "", false);
      });
      const focusedPath = await previewBecomesActive();
      await pressInSearchInput({ key: "Enter", metaKey: true, ctrlKey: true });
      await browser.waitUntil(
        async () =>
          (
            await browser.executeObsidian(({ app }) =>
              app.workspace
                .getLeavesOfType("markdown")
                .map(
                  (leaf) =>
                    (leaf.view as { file?: { path: string } }).file?.path,
                ),
            )
          ).includes(focusedPath),
        { timeoutMsg: `Mod+Enter did not open ${focusedPath} in a tab` },
      );
    });
  });

  it("runs the close callback once however often the modal is closed", async () => {
    await waitForPlugin();
    await browser.executeObsidianCommand(
      `${PLUGIN_ID}:search-obsidian-globally`,
    );
    await browser
      .$(".search-open-modal .search-input-container input")
      .waitForExist();
    const { calls, forgotten } = await browser.executeObsidian(
      ({ app }, id) => {
        const plugin = app.plugins.plugins[id];
        const { modal } = plugin;
        let calls = 0;
        const original = modal.cb;
        modal.cb = (...args) => {
          calls++;
          original(...args);
        };
        modal.close();
        modal.close();
        return { calls, forgotten: plugin.modal === undefined };
      },
      PLUGIN_ID,
    );
    expect(calls).toBe(1);
    expect(forgotten).toBe(true);
  });

  it("previews the clicked result when two notes share a name", async () => {
    await searchFor("pineapple");
    await waitForResults();
    await browser.keys(["ArrowDown"]);
    await browser
      .$(".search-open-modal .search-open-modal-file-ctn")
      .waitForExist({ timeoutMsg: "no preview pane appeared" });
    for (const path of ["Archive/Pineapple.md", "Pineapple.md"]) {
      await browser.executeObsidian(
        ({ app }, id, wanted) => {
          const { view } = app.plugins.plugins[id].modal.searchLeaf;
          for (const [file, item] of view.dom.resultDomLookup) {
            if (file.path === wanted) {
              item.el.querySelector<HTMLElement>(".tree-item-self")?.click();
            }
          }
        },
        PLUGIN_ID,
        path,
      );
      await browser.waitUntil(
        async () =>
          (await browser.executeObsidian(
            ({ app }, id) =>
              app.plugins.plugins[id].modal.fileLeaf?.view.file?.path,
            PLUGIN_ID,
          )) === path,
        { timeoutMsg: `the preview did not switch to ${path}` },
      );
    }
  });

  it("closes the preview on Shift+Tab and leaves no trace of it", async () => {
    await searchFor("pineapple");
    await waitForResults();
    await browser.keys(["ArrowDown"]);
    const previewPane = ".search-open-modal .search-open-modal-file-ctn";
    await browser
      .$(previewPane)
      .waitForExist({ timeoutMsg: "no preview pane appeared" });
    await browser.execute((selector) => {
      document.querySelector<HTMLInputElement>(selector)?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, ".search-open-modal .search-input-container input");
    await browser
      .$(previewPane)
      .waitForExist({ reverse: true, timeoutMsg: "the preview stayed open" });
    const leftovers = await browser.execute(() => ({
      borderClass: document
        .querySelector(".search-open-modal-content")
        ?.classList.contains("has-file-ctn"),
      wide: document
        .querySelector(".search-open-modal")
        ?.classList.contains("search-open-width"),
    }));
    expect(leftovers).toEqual({ borderClass: false, wide: false });
    expect(
      await browser.executeObsidian(
        ({ app }, id) => app.plugins.plugins[id].modal.fileLeaf === undefined,
        PLUGIN_ID,
      ),
    ).toBe(true);
  });

  it("puts Obsidian's own workspace methods back when the plugin is disabled", async () => {
    await waitForPlugin();
    const { patched, restored } = await browser.executeObsidian(
      async ({ app }, id) => {
        const proto = Object.getPrototypeOf(app.workspace) as Record<
          string,
          unknown
        >;
        const methods = [
          "getLeaf",
          "pushUndoHistory",
          "recordMostRecentOpenedFile",
        ];
        const native = methods.map((name) => proto[name]);
        const plugin = app.plugins.plugins[id];
        plugin.initModal({ ...plugin.state, query: "" });
        const sameAsNative = () =>
          methods.every((name, index) => proto[name] === native[index]);
        const patched = !sameAsNative();
        await app.plugins.disablePlugin(id);
        return { patched, restored: sameAsNative() };
      },
      PLUGIN_ID,
    );
    expect(patched).toBe(true);
    expect(restored).toBe(true);
  });

  describe("reopening with the last state", () => {
    const INPUT = ".search-open-modal .search-input-container input";

    async function reopenWithCaret(query: string, start: number, end: number) {
      await waitForPlugin();
      await browser.executeObsidian(
        ({ app }, id, q) => {
          const plugin = app.plugins.plugins[id];
          plugin.initModal({ ...plugin.state, query: q });
        },
        PLUGIN_ID,
        query,
      );
      const input = browser.$(INPUT);
      await input.waitForExist();
      await browser.execute(
        (selector, a, b) => {
          const el = document.querySelector<HTMLInputElement>(selector);
          el?.focus();
          el?.setSelectionRange(a, b);
        },
        INPUT,
        start,
        end,
      );
      await browser.executeObsidian(({ app }, id) => {
        app.plugins.plugins[id].modal.close();
      }, PLUGIN_ID);
      await browser.executeObsidianCommand(
        `${PLUGIN_ID}:search-obsidian-globally-state`,
      );
      await browser.$(INPUT).waitForExist();
    }

    const caret = () =>
      browser.execute((selector) => {
        const el = document.querySelector<HTMLInputElement>(selector);
        return [el?.value, el?.selectionStart, el?.selectionEnd];
      }, INPUT);

    it("puts the cursor back where it was", async () => {
      await reopenWithCaret("hello world", 3, 3);
      await browser.waitUntil(
        async () => (await caret()).join() === "hello world,3,3",
        { timeoutMsg: `the caret moved: ${JSON.stringify(await caret())}` },
      );
    });

    it("restores a selection too", async () => {
      await reopenWithCaret("hello world", 2, 7);
      await browser.waitUntil(
        async () => (await caret()).join() === "hello world,2,7",
        {
          timeoutMsg: `the selection changed: ${JSON.stringify(await caret())}`,
        },
      );
    });

    it("does show the search options menu when you type an operator", async () => {
      await waitForPlugin();
      await browser.executeObsidianCommand(
        `${PLUGIN_ID}:search-obsidian-globally`,
      );
      await browser.$(INPUT).waitForExist();
      await browser.keys(["p", "a"]);
      await browser
        .$(".suggestion-container.mod-search-suggestion")
        .waitForExist({ timeoutMsg: "the control never saw the menu appear" });
    });

    it("does not show the search options menu", async () => {
      await reopenWithCaret("pa", 2, 2);
      await browser.pause(600);
      expect(
        await browser
          .$(".suggestion-container.mod-search-suggestion")
          .isExisting(),
      ).toBe(false);
    });
  });
});
