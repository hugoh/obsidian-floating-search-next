import { browser, expect } from "@wdio/globals";
import { afterEach, beforeEach, describe, it } from "mocha";
import {
  activePath,
  closeModals,
  hasResult,
  openCmdk,
  PLUGIN_ID,
  updateSettings,
  waitForResult,
} from "./helpers";

describe("Quick search (CMDK)", () => {
  beforeEach(async () => {
    await updateSettings({
      excludeFolders: [],
      excludeFiles: [],
      filterUseRegex: false,
      filterMatchCase: false,
      filterStarredOnly: false,
      filterIncludeBases: true,
      filterIncludeCanvas: true,
      cmdkAutoPreview: true,
    });
  });

  afterEach(async () => {
    await closeModals();
  });

  it("opens when the trigger key is double-tapped", async () => {
    await updateSettings({
      cmdkTriggerKey: "Shift",
      cmdkDoubleTapInterval: 600,
    });
    await browser.keys("Shift");
    await browser.keys("Shift");
    await browser.$(".pane-search-cmdk").waitForExist({ timeout: 5000 });
  });

  it("previews the selected result automatically by default", async () => {
    await updateSettings({ cmdkAutoPreview: true });
    const input = await openCmdk();
    await input.setValue("pineapple");
    await waitForResult("Pineapple");
    // The first row is "save this search"; move onto a note.
    await browser.keys("ArrowDown");
    await browser
      .$(".pane-search-cmdk-expanded")
      .waitForExist({ timeout: 10_000 });
  });

  it("only previews on Tab when automatic previews are off", async () => {
    await updateSettings({ cmdkAutoPreview: false });
    const input = await openCmdk();
    await input.setValue("pineapple");
    await waitForResult("Pineapple");
    await browser.keys("ArrowDown");
    await browser.pause(800);
    expect(await browser.$(".pane-search-cmdk-expanded").isExisting()).toBe(
      false,
    );

    await browser.keys("Tab");
    await browser
      .$(".pane-search-cmdk-expanded")
      .waitForExist({ timeout: 10_000 });
    await updateSettings({ cmdkAutoPreview: true });
  });

  it("marks active filters and lets you reset them", async () => {
    await updateSettings({ filterStarredOnly: true, filterMatchCase: true });
    await openCmdk();
    const marker = browser.$(".pane-search-cmdk-container .fs-filter-active");
    await marker.waitForDisplayed();
    expect(await marker.getText()).toContain("2 filters on");

    await marker.$("button").click();
    await browser.waitUntil(async () => !(await marker.isDisplayed()), {
      timeoutMsg: "the marker stayed after Reset",
    });
    const settings = await browser.executeObsidian(
      ({ app }, id) => app.plugins.plugins[id].settings,
      PLUGIN_ID,
    );
    expect(settings.filterStarredOnly).toBe(false);
    expect(settings.filterMatchCase).toBe(false);
  });

  it("shows no marker with the default filters", async () => {
    await openCmdk();
    expect(
      await browser
        .$(".pane-search-cmdk-container .fs-filter-active")
        .isDisplayed(),
    ).toBe(false);
  });

  it("block: needs every term in the same paragraph", async () => {
    const input = await openCmdk();
    await input.setValue("block:(yellow pineapple)");
    await waitForResult("Banana");
    await input.setValue("block:(tropical yellow)");
    await browser.pause(800);
    expect(await hasResult("Banana")).toBe(false);
    expect(await hasResult("Pineapple")).toBe(false);
  });

  it("section: needs every term under the same heading", async () => {
    const input = await openCmdk();
    await input.setValue("section:(banana yellow)");
    await waitForResult("Banana");
    await input.setValue("section:(banana tropical)");
    await browser.pause(800);
    expect(await hasResult("Banana")).toBe(false);
  });

  it("renders the filter icons", async () => {
    await openCmdk();
    const icons = await browser.$$(".pane-search-cmdk .fs-filter-icon svg");
    expect(icons.length).toBe(2);
  });

  it("finds notes by name and opens the selected one", async () => {
    const input = await openCmdk();
    await input.setValue("pineapple");
    await waitForResult("Pineapple");
    expect(await hasResult("Other")).toBe(false);

    await browser.$$(".suggestion-item*=Pineapple")[0].click();
    await browser.waitUntil(
      async () => (await activePath()) === "Pineapple.md",
      {
        timeoutMsg: "Pineapple.md was not opened",
      },
    );
  });

  it("searches note content", async () => {
    const input = await openCmdk();
    await input.setValue("tropical");
    await waitForResult("Pineapple");
  });

  it("hides excluded folders from the results", async () => {
    await updateSettings({ excludeFolders: ["Archive"] });
    const input = await openCmdk();
    await input.setValue("pineapple");
    await waitForResult("Pineapple");
    expect(await hasResult("Old")).toBe(false);
  });

  it("hides excluded files from the results", async () => {
    await updateSettings({ excludeFiles: ["Pineapple.md"] });
    const input = await openCmdk();
    await input.setValue("pineapple");
    await waitForResult("Old");
    expect(await hasResult("Pineapple")).toBe(false);
  });

  it("understands query operators such as path: and negation", async () => {
    const input = await openCmdk();
    await input.setValue("pineapple -path:Archive");
    await waitForResult("Pineapple");
    expect(await hasResult("Old")).toBe(false);
  });

  it("matches exact words inside notes, not near misses", async () => {
    const input = await openCmdk();
    await input.setValue("marker7");
    await waitForResult("Notes/Seven.md");
    await browser.pause(800);
    expect(await hasResult("Seventeen")).toBe(false);
  });

  it("treats only real tags as tags", async () => {
    const input = await openCmdk();
    await input.setValue("tag:fruit");
    await waitForResult("Pineapple");
    expect(await hasResult("Banana")).toBe(false);
    await input.setValue("tag:banana");
    await browser.pause(600);
    expect(await hasResult("Banana")).toBe(false);
  });

  it("supports regular expressions when enabled", async () => {
    await updateSettings({ filterUseRegex: true });
    const input = await openCmdk();
    await input.setValue("^Pine.*le$");
    await waitForResult("Pineapple");
    expect(await hasResult("Banana")).toBe(false);
  });

  it("creates quick notes without clobbering an existing one", async () => {
    await updateSettings({
      cmdkQuickCreate: true,
      cmdkQuickCreateFolder: "Created",
      cmdkQuickCreateTitleFormat: "[qc]-YYYY",
    });
    const createNote = async (text: string) => {
      const input = await openCmdk();
      await input.setValue(text);
      const item = browser.$(".pane-search-cmdk-create-item");
      await item.waitForExist();
      await item.click();
      await browser.waitUntil(
        async () => (await activePath())?.startsWith("Created/") ?? false,
      );
    };

    await createNote("zzz first");
    const year = new Date().getFullYear();
    expect(await activePath()).toBe(`Created/qc-${year}.md`);
    await createNote("zzz second");
    expect(await activePath()).toBe(`Created/qc-${year} 1.md`);

    const bodies = await browser.executeObsidian(async ({ app }) => {
      const notes = app.vault
        .getMarkdownFiles()
        .filter((file) => file.path.startsWith("Created/"));
      return Promise.all(notes.map((file) => app.vault.read(file)));
    });
    expect(bodies.sort()).toEqual(["zzz first", "zzz second"]);
    await updateSettings({ cmdkQuickCreate: false, cmdkQuickCreateFolder: "" });
  });

  it("explains when a regular expression is refused as unsafe", async () => {
    await updateSettings({ filterUseRegex: true });
    const input = await openCmdk();
    await input.setValue("^(a+)+$");
    await browser
      .$(".pane-search-cmdk-notice")
      .waitForExist({ timeout: 10_000 });
    expect(await browser.$(".pane-search-cmdk-notice").getText()).toContain(
      "too complex",
    );
  });

  it("shows quick-create when nothing matches", async () => {
    await updateSettings({ cmdkQuickCreate: true });
    const input = await openCmdk();
    await input.setValue("zzz-no-such-note");
    await browser.waitUntil(
      async () =>
        (await browser.$$(".pane-search-cmdk .suggestion-item")).length > 0,
      { timeoutMsg: "no quick-create suggestion appeared" },
    );
    await updateSettings({ cmdkQuickCreate: false });
  });
});
