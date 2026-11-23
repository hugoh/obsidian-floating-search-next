import {
  AbstractInputSuggest,
  type App,
  PluginSettingTab,
  prepareFuzzySearch,
  type Setting,
  type SettingDefinitionItem,
  TFile,
  TFolder,
} from "obsidian";
import { strings } from "./i18n";
import type PaneSearchPlugin from "./paneSearchIndex";
import type { CmdkTriggerKey } from "./settings";
import { DOUBLE_TAP_RANGE } from "./settings";

const triggerKeyOptions = (): Record<CmdkTriggerKey, string> => {
  const s = strings();
  return {
    Shift: s.triggerShift,
    Control: s.triggerControl,
    Alt: s.triggerAlt,
    Meta: s.triggerMeta,
    none: s.triggerNone,
  };
};

/**
 * Folder / file picker backed by the official vault API. As the user types,
 * it shows a fuzzy-filtered list of real vault folders or files, so the
 * exact path never has to be typed by hand.
 */
class PathSuggest extends AbstractInputSuggest<TFolder | TFile> {
  constructor(
    app: App,
    private inputEl: HTMLInputElement,
    private kind: "folder" | "file",
    private onPick: (path: string) => void | Promise<void>,
  ) {
    super(app, inputEl);
  }

  getSuggestions(query: string): (TFolder | TFile)[] {
    const pool = this.app.vault
      .getAllLoadedFiles()
      .filter((f) =>
        this.kind === "folder"
          ? f instanceof TFolder && f.path !== ""
          : f instanceof TFile,
      ) as (TFolder | TFile)[];
    if (!query) return pool.slice(0, 50);
    const fuzzy = prepareFuzzySearch(query);
    return pool
      .map((f) => ({ f, m: fuzzy(f.path) }))
      .filter((x) => x.m)
      .sort((a, b) => (b.m!.score ?? -Infinity) - (a.m!.score ?? -Infinity))
      .slice(0, 50)
      .map((x) => x.f);
  }

  renderSuggestion(value: TFolder | TFile, el: HTMLElement) {
    el.setText(value.path || "/");
  }

  selectSuggestion(value: TFolder | TFile) {
    void this.onPick(value.path);
    this.inputEl.value = "";
    this.close();
  }
}

export class PaneSearchSettingTab extends PluginSettingTab {
  plugin: PaneSearchPlugin;

  constructor(app: App, plugin: PaneSearchPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Describes every setting declaratively, so Obsidian can search them.
   * Rows that need more than a plain control (path pickers, the saved-search
   * editor) render imperatively through `render`.
   */
  override getSettingDefinitions(): SettingDefinitionItem[] {
    const s = strings();
    const viewTypes = s.viewType;
    return [
      {
        type: "group",
        heading: s.tabGeneral,
        items: [
          {
            name: this.plugin.manifest.name,
            desc: s.pluginIntro,
            searchable: false,
            render: () => {},
          },
          {
            name: s.defaultViewType,
            control: {
              type: "dropdown",
              key: "defaultViewType",
              options: {
                modal: viewTypes.modal,
                split: viewTypes.split,
                tab: viewTypes.tab,
                window: viewTypes.window,
                sidebar: viewTypes.sidebar,
              },
            },
          },
          {
            name: s.showFilePath,
            control: { type: "toggle", key: "showFilePath" },
          },
          {
            name: s.showInstructions,
            control: { type: "toggle", key: "showInstructions" },
          },
        ],
      },
      {
        type: "group",
        heading: s.tabQuickSearch,
        items: [
          {
            name: s.quickSearchTrigger,
            desc: s.quickSearchTriggerDesc,
            control: {
              type: "dropdown",
              key: "cmdkTriggerKey",
              options: triggerKeyOptions(),
            },
          },
          {
            name: s.autoPreview,
            desc: s.autoPreviewDesc,
            control: { type: "toggle", key: "cmdkAutoPreview" },
          },
          {
            name: s.doubleTapInterval,
            desc: s.doubleTapIntervalDesc,
            control: {
              type: "slider",
              key: "cmdkDoubleTapInterval",
              min: DOUBLE_TAP_RANGE.min,
              max: DOUBLE_TAP_RANGE.max,
              step: 50,
            },
          },
        ],
      },
      {
        type: "group",
        heading: s.tabQuickCreate,
        items: [
          {
            name: s.enableQuickCreate,
            desc: s.enableQuickCreateDesc,
            control: { type: "toggle", key: "cmdkQuickCreate" },
          },
          {
            name: s.quickCreateFolder,
            desc: s.quickCreateFolderDesc,
            control: {
              type: "folder",
              key: "cmdkQuickCreateFolder",
              placeholder: s.quickCreateFolderPlaceholder,
            },
          },
          {
            name: s.titleFormat,
            desc: s.titleFormatDesc,
            control: { type: "text", key: "cmdkQuickCreateTitleFormat" },
          },
        ],
      },
      ...this.filterDefinitions(),
    ];
  }

  private filterDefinitions(): SettingDefinitionItem[] {
    const s = strings();
    const settings = this.plugin.settings;
    const removeAt = (paths: string[]) => (index: number) => {
      paths.splice(index, 1);
      void this.plugin.saveSettings();
      this.update();
    };
    const pathRow = (kind: "folder" | "file", paths: string[]) => ({
      name: kind === "folder" ? s.excludeFolders : s.excludeFiles,
      desc: kind === "folder" ? s.excludeFoldersDesc : s.excludeFilesDesc,
      render: (setting: Setting) => {
        setting.addText((text) => {
          text.setPlaceholder(kind === "folder" ? s.phTemplates : s.phSecrets);
          new PathSuggest(this.app, text.inputEl, kind, async (path) => {
            if (paths.includes(path)) return;
            paths.push(path);
            await this.plugin.saveSettings();
            this.update();
          });
        });
      },
    });
    const pathList = (paths: string[]): SettingDefinitionItem => ({
      type: "list",
      onDelete: removeAt(paths),
      items: paths.map((path) => ({
        name: path,
        render: () => {},
      })),
    });

    return [
      {
        type: "group",
        heading: s.exclusions,
        items: [
          pathRow("folder", settings.excludeFolders),
          pathRow("file", settings.excludeFiles),
        ],
      },
      pathList(settings.excludeFolders),
      pathList(settings.excludeFiles),
      {
        type: "group",
        heading: s.savedSearches,
        items: [this.addSavedSearchRow()],
      },
      {
        type: "list",
        emptyState: s.noSavedSearches,
        onDelete: (index) => {
          settings.savedSearches.splice(index, 1);
          void this.plugin.saveSettings();
          this.plugin.syncSavedSearchCommands();
          this.update();
        },
        items: settings.savedSearches.map((saved) => ({
          name: saved.name,
          render: (setting: Setting) => {
            const rename =
              (apply: (value: string) => void) => (value: string) => {
                const trimmed = value.trim();
                if (!trimmed) return;
                apply(trimmed);
                void this.plugin.saveSettings();
                this.plugin.syncSavedSearchCommands();
              };
            setting
              .addText((text) =>
                text
                  .setPlaceholder(s.namePlaceholder)
                  .setValue(saved.name)
                  .onChange(rename((value) => (saved.name = value))),
              )
              .addText((text) =>
                text
                  .setPlaceholder(s.queryPlaceholder)
                  .setValue(saved.query)
                  .onChange(rename((value) => (saved.query = value))),
              );
          },
        })),
      },
    ];
  }

  private addSavedSearchRow() {
    const s = strings();
    return {
      name: s.addSavedSearch,
      desc: s.addSavedSearchDesc,
      render: (setting: Setting) => {
        let name = "";
        let query = "";
        setting
          .addText((text) =>
            text.setPlaceholder(s.namePlaceholder).onChange((v) => (name = v)),
          )
          .addText((text) =>
            text
              .setPlaceholder(s.queryPlaceholder)
              .onChange((v) => (query = v)),
          )
          .addButton((button) =>
            button
              .setButtonText(s.add)
              .setCta()
              .onClick(async () => {
                if (!name.trim() || !query.trim()) return;
                await this.plugin.addSavedSearch(name.trim(), query.trim());
                this.update();
              }),
          );
      },
    };
  }

  override getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    if (key === "showFilePath") this.plugin.updateFilePathVisibility();
    await this.plugin.saveSettings();
  }
}
