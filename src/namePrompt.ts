import { type App, Modal } from "obsidian";
import { strings } from "./i18n";

class NamePromptModal extends Modal {
  private defaultValue: string;
  private result: (value: string | null) => void;

  constructor(
    app: App,
    defaultValue: string,
    result: (value: string | null) => void,
  ) {
    super(app);
    this.defaultValue = defaultValue;
    this.result = result;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pane-search-prompt");
    contentEl.createEl("h3", { text: strings().saveAsPreset });
    const input = contentEl.createEl("input", {
      type: "text",
      placeholder: strings().presetName,
    });
    input.value = this.defaultValue;
    const row = contentEl.createDiv({ cls: "pane-search-prompt-row" });
    const ok = row.createEl("button", { text: strings().save });
    const cancel = row.createEl("button", { text: strings().cancel });

    const submit = () => {
      const v = input.value.trim();
      this.result(v || this.defaultValue);
      this.close();
    };
    ok.onClickEvent(() => submit());
    cancel.onClickEvent(() => {
      this.result(null);
      this.close();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") {
        this.result(null);
        this.close();
      }
    });
    window.setTimeout(() => input.focus(), 0);
  }

  onClose() {
    this.contentEl.empty();
  }
}

export function promptForName(
  app: App,
  defaultValue: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    new NamePromptModal(app, defaultValue, resolve).open();
  });
}
