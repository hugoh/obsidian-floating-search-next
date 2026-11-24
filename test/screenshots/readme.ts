import * as path from "node:path";
import { browser } from "@wdio/globals";
import { describe, it } from "mocha";
import { PLUGIN_ID, waitForPlugin } from "../specs/helpers";

const MODAL = ".search-open-modal";

describe("README screenshot", () => {
  it("captures the search modal with a preview", async () => {
    await waitForPlugin();
    await browser.executeObsidianCommand(
      `${PLUGIN_ID}:search-obsidian-globally`,
    );
    const input = browser.$(`${MODAL} .search-input-container input`);
    await input.waitForExist();
    await browser.waitUntil(() => input.isFocused());
    await browser.keys("pineapple".split(""));
    await browser.waitUntil(
      async () =>
        (await browser.$$(`${MODAL} .search-result-file-title`)).length > 2,
      { timeoutMsg: "the search returned too few results" },
    );
    await browser.keys(["ArrowDown"]);
    await browser.pause(300);
    await browser.keys(["Tab"]);
    await browser
      .$(`${MODAL} .search-open-modal-file-ctn`)
      .waitForExist({ timeoutMsg: "no preview pane appeared" });
    await browser.pause(1000);
    await browser.$(MODAL).saveScreenshot(path.resolve("media/screenshot.png"));
  });
});
