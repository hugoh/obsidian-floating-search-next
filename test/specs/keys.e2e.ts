import { browser, expect } from "@wdio/globals";
import { afterEach, describe, it } from "mocha";
import {
  closeModals,
  PLUGIN_ID,
  pressInSearchInput,
  resetPlugin,
  searchFor,
  waitForResults,
} from "./helpers";

const INPUT = ".search-open-modal .search-input-container input";

interface Focused {
  kind: "none" | "file" | "match";
  collapsed: boolean | undefined;
}

describe("Search & Open keys", () => {
  afterEach(async () => {
    await closeModals();
    await resetPlugin();
  });

  const focused = () =>
    browser.executeObsidian(({ app }, id): Focused => {
      const item = (
        app.plugins.plugins[id].modal.searchLeaf.view.dom as unknown as {
          focusedItem?: { file?: unknown; collapsed?: boolean } | null;
        }
      ).focusedItem;
      if (!item) return { kind: "none", collapsed: undefined };
      return {
        kind: item.file ? "file" : "match",
        collapsed: item.collapsed,
      };
    }, PLUGIN_ID);

  const settled = async (expected: Partial<Focused>) => {
    await browser.waitUntil(
      async () => {
        const now = await focused();
        return Object.entries(expected).every(
          ([key, value]) => now[key as keyof Focused] === value,
        );
      },
      {
        timeoutMsg: `the focused result never became ${JSON.stringify(expected)}`,
      },
    );
  };

  const results = async () => {
    await searchFor("pineapple");
    await waitForResults();
  };

  const previewOpen = () =>
    browser
      .$(".search-open-modal .search-open-modal-file-ctn")
      .waitForExist({ timeoutMsg: "no preview pane appeared" });

  const inputHasFocus = () =>
    browser.execute(
      (selector) => document.activeElement === document.querySelector(selector),
      INPUT,
    );

  it("moves down and up with the arrow keys", async () => {
    await results();
    await browser.keys(["ArrowDown"]);
    await settled({ kind: "file" });
    await browser.keys(["ArrowDown"]);
    await settled({ kind: "match" });
    await browser.keys(["ArrowUp"]);
    await settled({ kind: "file" });
  });

  it("moves with Ctrl+N and Ctrl+P too", async () => {
    await results();
    await pressInSearchInput({ key: "n", ctrlKey: true });
    await settled({ kind: "file" });
    await pressInSearchInput({ key: "n", ctrlKey: true });
    await settled({ kind: "match" });
    await pressInSearchInput({ key: "p", ctrlKey: true });
    await settled({ kind: "file" });
  });

  it("keeps typing n and p when Ctrl is not held", async () => {
    await searchFor("n");
    await browser.keys(["p"]);
    expect(await browser.$(INPUT).getValue()).toBe("np");
  });

  it("collapses a file with Shift+Up and expands it with Shift+Down", async () => {
    await results();
    await browser.keys(["ArrowDown"]);
    await settled({ kind: "file", collapsed: false });
    await browser.keys(["Shift", "ArrowUp"]);
    await settled({ collapsed: true });
    await browser.keys(["Shift", "ArrowDown"]);
    await settled({ collapsed: false });
  });

  it("moves the caret with Left and Right, even with a result focused", async () => {
    await results();
    await browser.keys(["ArrowDown"]);
    await settled({ kind: "file" });
    const caret = () =>
      browser.execute(
        (selector) =>
          document.querySelector<HTMLInputElement>(selector)?.selectionStart,
        INPUT,
      );
    const end = await caret();
    await browser.keys(["ArrowLeft", "ArrowLeft"]);
    expect(await caret()).toBe((end ?? 0) - 2);
    await browser.keys(["ArrowRight"]);
    expect(await caret()).toBe((end ?? 0) - 1);
  });

  it("ignores keys pressed while composing text", async () => {
    await results();
    await pressInSearchInput({ key: "ArrowDown", isComposing: true });
    await pressInSearchInput({ key: "Process" });
    await browser.pause(300);
    expect((await focused()).kind).toBe("none");
    await pressInSearchInput({ key: "ArrowDown" });
    await settled({ kind: "file" });
  });

  it("keeps focus in the search box when Tab finds nothing to preview", async () => {
    await results();
    await browser.keys(["Tab"]);
    await browser.pause(300);
    expect(await inputHasFocus()).toBe(true);
    expect(
      await browser
        .$(".search-open-modal .search-open-modal-file-ctn")
        .isExisting(),
    ).toBe(false);
  });

  it("jumps into the preview and back with Ctrl+G", async () => {
    await results();
    await browser.keys(["ArrowDown", "Tab"]);
    await previewOpen();
    const focusInPreview = () =>
      browser.execute(() =>
        Boolean(
          document.activeElement?.closest(
            ".search-open-modal .search-open-modal-file-ctn",
          ),
        ),
      );
    expect(await focusInPreview()).toBe(false);
    await pressInSearchInput({ key: "g", ctrlKey: true });
    await browser.waitUntil(focusInPreview, {
      timeoutMsg: "Ctrl+G did not move into the preview",
    });
    await browser.keys(["Control", "g"]);
    await browser.waitUntil(inputHasFocus, {
      timeoutMsg: "Ctrl+G did not come back to the search box",
    });
  });

  it("leaves the arrow keys to the preview while it has focus", async () => {
    await results();
    await browser.keys(["ArrowDown", "Tab"]);
    await previewOpen();
    await pressInSearchInput({ key: "g", ctrlKey: true });
    await browser.waitUntil(
      () =>
        browser.execute(() =>
          Boolean(
            document.activeElement?.closest(
              ".search-open-modal .search-open-modal-file-ctn",
            ),
          ),
        ),
      { timeoutMsg: "Ctrl+G did not move into the preview" },
    );
    const before = await focused();
    await browser.keys(["ArrowDown"]);
    await browser.pause(400);
    expect(await focused()).toEqual(before);
  });

  it("does nothing on Ctrl+G without a preview", async () => {
    await results();
    await pressInSearchInput({ key: "g", ctrlKey: true });
    await browser.pause(300);
    expect(await inputHasFocus()).toBe(true);
  });
});
