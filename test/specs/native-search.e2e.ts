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

  // Reading mode only flashes the matched block for a moment; the match itself
  // has to stay marked, as it does in an editor.
  describe("the match in the preview", () => {
    const markedText = () =>
      browser.execute(() => {
        const highlight = (
          CSS as unknown as {
            highlights: Map<string, Iterable<{ toString(): string }>>;
          }
        ).highlights.get("search-open-match");
        return highlight ? Array.from(highlight, (range) => String(range)) : [];
      });

    // The registry can hold a mark that the page never draws.
    const paintedBackground = () =>
      browser.execute(() => {
        const highlight = (
          CSS as unknown as { highlights: Map<string, Iterable<Range>> }
        ).highlights.get("search-open-match");
        const element = highlight
          ? Array.from(highlight)[0]?.startContainer.parentElement
          : null;
        return element
          ? getComputedStyle(element, "::highlight(search-open-match)")
              .backgroundColor
          : "";
      });

    async function previewFirstMatch() {
      await searchFor("pineapple");
      await waitForResults();
      // The second row is the first match of the first file.
      await browser.keys(["ArrowDown", "ArrowDown", "Tab"]);
      await browser
        .$(".search-open-modal .search-open-modal-file-ctn")
        .waitForExist({ timeoutMsg: "no preview pane appeared" });
    }

    it("stays marked after Obsidian's flash has faded", async () => {
      await previewFirstMatch();
      await browser.waitUntil(async () => (await markedText()).length > 0, {
        timeoutMsg: "the matched text was never marked",
      });
      await browser.pause(3000);
      const marked = await markedText();
      expect(marked.length).toBeGreaterThan(0);
      for (const text of marked) expect(text.toLowerCase()).toBe("pineapple");
    });

    it("is drawn, not just registered", async () => {
      await previewFirstMatch();
      await browser.waitUntil(async () => (await markedText()).length > 0);
      const background = await paintedBackground();
      expect(background).not.toBe("");
      expect(background).not.toBe("rgba(0, 0, 0, 0)");
    });

    it("is cleared when the modal closes", async () => {
      await previewFirstMatch();
      await browser.waitUntil(async () => (await markedText()).length > 0);
      await closeModals();
      await browser.waitUntil(async () => (await markedText()).length === 0, {
        timeoutMsg: "the mark outlived the modal",
      });
    });
  });

  // Obsidian's search addon runs highlight clean-up on markdown editors on
  // every search. An editor inside the embedded preview once lacked the field
  // it reads and threw "Field is not present in this state"; the preview is
  // now reading mode and the crash guard is gone, so this keeps it honest.
  it("survives a second search while a preview is open", async () => {
    await searchFor("pineapple");
    await waitForResults();
    await focusFirstResult();
    const preview = ".search-open-modal .search-open-modal-file-ctn";
    await browser
      .$(preview)
      .waitForExist({ timeoutMsg: "no preview pane appeared" });

    await browser.execute(() => {
      const seen: string[] = [];
      const target = window as unknown as { __searchOpenErrors: string[] };
      target.__searchOpenErrors = seen;
      window.addEventListener("error", (e) =>
        seen.push(String(e.error ?? e.message)),
      );
      window.addEventListener("unhandledrejection", (e) =>
        seen.push(String(e.reason)),
      );
      const original = console.error.bind(console);
      console.error = (...args: unknown[]) => {
        seen.push(args.map(String).join(" "));
        original(...args);
      };
    });

    // Typing over a selected query runs a second search.
    await browser.execute((selector) => {
      document.querySelector<HTMLInputElement>(selector)?.select();
    }, ".search-open-modal .search-input-container input");
    // One key at a time: the first one closes the preview and focus must
    // come back to the input before the next arrives.
    for (const key of "banana") {
      await browser.keys([key]);
      await browser.pause(50);
    }
    await browser.waitUntil(
      async () => {
        const matched = await browser.execute(
          (selector) =>
            Array.from(
              document.querySelectorAll<HTMLElement>(selector),
              (el) => el.textContent ?? "",
            ),
          ".search-open-modal .search-result-file-matched-text",
        );
        return matched.length > 0 && matched.every((t) => /banana/i.test(t));
      },
      { timeoutMsg: "the second search never replaced the results" },
    );

    // Preview a result of the second search, then run what the addon runs.
    await focusFirstResult();
    await browser.$(preview).waitForExist({ timeoutMsg: "no second preview" });
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(
          ({ app }, id) =>
            Boolean(app.plugins.plugins[id].modal.fileLeaf?.view.file),
          PLUGIN_ID,
        ),
      { timeoutMsg: "the second preview never opened a file" },
    );
    const thrown = await browser.executeObsidian(({ app }, id) => {
      const view = app.plugins.plugins[id].modal.fileLeaf?.view as unknown as
        | { editor?: Record<string, (() => unknown) | undefined> }
        | undefined;
      const out: string[] = [];
      for (const name of ["removeHighlights", "hasHighlight"]) {
        try {
          view?.editor?.[name]?.();
        } catch (error) {
          out.push(`${name}: ${String(error)}`);
        }
      }
      return out;
    }, PLUGIN_ID);
    expect(thrown).toEqual([]);

    const seen = await browser.execute(
      () =>
        (window as unknown as { __searchOpenErrors: string[] })
          .__searchOpenErrors,
    );
    expect(seen.filter((m) => /not present in this state/.test(m))).toEqual([]);
    expect(await browser.$(".search-open-modal").isExisting()).toBe(true);
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

  it("closes the modal when a result is dragged out", async () => {
    await searchFor("pineapple");
    await waitForResults();
    await browser.execute((selector) => {
      document
        .querySelector(selector)
        ?.dispatchEvent(new DragEvent("dragstart", { bubbles: true }));
    }, TITLES);
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

  it("selects the matching canvas card even when the canvas loads slowly", async () => {
    await waitForPlugin();
    await browser.executeObsidian(({ app }) => {
      // Slow down canvas reads, as a big canvas or a cold disk would.
      const w = window as unknown as { restoreReads: () => void };
      const vault = app.vault as unknown as Record<string, unknown>;
      const originals = ["read", "cachedRead"].map((name) => [
        name,
        vault[name] as (...args: unknown[]) => Promise<unknown>,
      ]);
      for (const [name, original] of originals as [
        string,
        (...args: unknown[]) => Promise<unknown>,
      ][]) {
        vault[name] = async (
          file: { extension: string },
          ...rest: unknown[]
        ) => {
          if (file.extension === "canvas") {
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
          return original.call(app.vault, file, ...rest);
        };
      }
      w.restoreReads = () => {
        for (const [name, original] of originals as [string, unknown][]) {
          vault[name] = original;
        }
      };
    });
    try {
      await searchFor("zebramarker");
      await waitForResults();
      await browser.keys(["ArrowDown", "ArrowDown"]);
      await browser.waitUntil(
        async () =>
          (
            await browser.executeObsidian(
              ({ app }, id) =>
                app.plugins.plugins[id].modal.searchLeaf.view.dom.focusedItem
                  ?.content ?? "",
              PLUGIN_ID,
            )
          ).includes("zebramarker"),
        { timeoutMsg: "the match line never received focus" },
      );
      await browser.waitUntil(
        async () =>
          (
            await browser.executeObsidian(
              ({ app }, id) =>
                [
                  ...(app.plugins.plugins[id].modal.fileLeaf?.view.canvas
                    ?.selection ?? []),
                ].map((card) => card.text),
              PLUGIN_ID,
            )
          ).join() === "bravo zebramarker card",
        { timeoutMsg: "the matching card was never selected" },
      );
    } finally {
      await browser.execute(() =>
        (window as unknown as { restoreReads: () => void }).restoreReads(),
      );
    }
  });

  describe("when Obsidian fails", () => {
    // Makes one Obsidian call reject for leaves inside the modal, and undoes it.
    async function failInModal(method: "openFile" | "setViewState") {
      await browser.executeObsidian(({ obsidian }, name) => {
        document.querySelectorAll(".notice").forEach((notice) => {
          notice.remove();
        });
        const proto = obsidian.WorkspaceLeaf.prototype as unknown as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >;
        const original = proto[name];
        proto[name] = function (this: { containerEl: HTMLElement }, ...args) {
          if (this.containerEl.closest(".search-open-embed")) {
            return Promise.reject(new Error(`boom-${name}`));
          }
          return original.apply(this, args);
        };
        (window as unknown as { undoFailure: () => void }).undoFailure = () => {
          proto[name] = original;
        };
      }, method);
    }

    const undoFailure = () =>
      browser.execute(() =>
        (window as unknown as { undoFailure?: () => void }).undoFailure?.(),
      );

    const noticeText = () =>
      browser.execute(() =>
        Array.from(
          document.querySelectorAll(".notice"),
          (el) => el.textContent,
        ),
      );

    it("says so, and leaves no empty pane, when a preview cannot be opened", async () => {
      await searchFor("pineapple");
      await waitForResults();
      await failInModal("openFile");
      try {
        await browser.keys(["ArrowDown"]);
        await browser.waitUntil(async () => (await noticeText()).length > 0, {
          timeoutMsg: "the failed preview was never reported",
        });
        expect((await noticeText()).join()).toContain("Search & Open");
        expect(
          await browser
            .$(".search-open-modal .search-open-modal-file-ctn")
            .isExisting(),
        ).toBe(false);
      } finally {
        await undoFailure();
      }
    });

    it("says so, and closes, when the search view cannot be built", async () => {
      await waitForPlugin();
      await failInModal("setViewState");
      try {
        await browser.executeObsidianCommand(
          `${PLUGIN_ID}:search-obsidian-globally`,
        );
        await browser.waitUntil(async () => (await noticeText()).length > 0, {
          timeoutMsg: "the failure was never reported",
        });
        expect((await noticeText()).join()).toContain("Search & Open");
        await browser
          .$(".search-open-modal")
          .waitForExist({ reverse: true, timeoutMsg: "the modal stayed open" });
      } finally {
        await undoFailure();
      }
    });
  });

  it("keeps the saved options when the modal closes before it finished opening", async () => {
    await waitForPlugin();
    await browser.executeObsidianCommand(
      `${PLUGIN_ID}:search-obsidian-globally`,
    );
    await browser
      .$(".search-open-modal .search-input-container input")
      .waitForExist();
    await browser.executeObsidian(({ app }, id) => {
      const { modal } = app.plugins.plugins[id];
      modal.searchLeaf.view.setSortOrder("byModifiedTime");
      modal.close();
    }, PLUGIN_ID);
    const saved = await browser.executeObsidian(({ app }, id) => {
      const plugin = app.plugins.plugins[id];
      // Open and close within one task, before the view has taken its state.
      plugin.initModal({ ...plugin.state, query: "" });
      plugin.modal.close();
      return {
        saved: plugin.settings.searchViewState.sortOrder,
        remembered: plugin.state.sortOrder,
      };
    }, PLUGIN_ID);
    expect(saved).toEqual({
      saved: "byModifiedTime",
      remembered: "byModifiedTime",
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

  it("leaves nothing in Obsidian's closed-tab history after a search and a preview", async () => {
    const closedTabs = () =>
      browser.executeObsidian(
        ({ app }) =>
          (app.workspace as unknown as { undoHistory: unknown[] }).undoHistory
            .length,
      );
    await waitForPlugin();
    const before = await closedTabs();
    await searchFor("pineapple");
    await waitForResults();
    await browser.keys(["ArrowDown", "Tab"]);
    await browser
      .$(".search-open-modal .search-open-modal-file-ctn")
      .waitForExist({ timeoutMsg: "no preview pane appeared" });
    await closeModals();
    await browser
      .$(".search-open-modal")
      .waitForExist({ reverse: true, timeoutMsg: "the modal stayed open" });
    expect(await closedTabs()).toBe(before);
  });

  it("puts Obsidian's own workspace methods back as soon as the modal closes", async () => {
    await waitForPlugin();
    const { before, open, closed } = await browser.executeObsidian(
      ({ app }, id) => {
        const proto = Object.getPrototypeOf(app.workspace) as Record<
          string,
          unknown
        >;
        const methods = ["getLeaf", "pushUndoHistory"];
        const native = methods.map((name) => proto[name]);
        const sameAsNative = () =>
          methods.every((name, index) => proto[name] === native[index]);
        const before = sameAsNative();
        const plugin = app.plugins.plugins[id];
        plugin.initModal({ ...plugin.state, query: "" });
        const open = sameAsNative();
        plugin.modal.close();
        return { before, open, closed: sameAsNative() };
      },
      PLUGIN_ID,
    );
    expect(before).toBe(true);
    expect(open).toBe(false);
    expect(closed).toBe(true);
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
