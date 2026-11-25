import {
  type App,
  PluginSettingTab,
  type SettingDefinitionItem,
} from "obsidian";
import { strings } from "./i18n";
import type SearchOpenPlugin from "./main";

export class SearchOpenSettingTab extends PluginSettingTab {
  plugin: SearchOpenPlugin;

  constructor(app: App, plugin: SearchOpenPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    const s = strings();
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
            name: s.showInstructions,
            control: { type: "toggle", key: "showInstructions" },
          },
        ],
      },
    ];
  }

  override getControlValue(key: string): unknown {
    return key === "showInstructions"
      ? this.plugin.settings.showInstructions
      : undefined;
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    if (key !== "showInstructions" || typeof value !== "boolean") return;
    this.plugin.settings.showInstructions = value;
    await this.plugin.saveSettings();
  }
}
