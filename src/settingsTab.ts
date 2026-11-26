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
    return [
      {
        type: "group",
        heading: strings.tabGeneral,
        items: [
          {
            name: this.plugin.manifest.name,
            desc: strings.pluginIntro,
            searchable: false,
            render: () => {},
          },
          {
            name: strings.showInstructions,
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
