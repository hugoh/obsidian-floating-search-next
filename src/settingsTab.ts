import {
  type App,
  PluginSettingTab,
  type SettingDefinitionItem,
} from "obsidian";
import { strings } from "./i18n";
import type PaneSearchPlugin from "./paneSearchIndex";

export class PaneSearchSettingTab extends PluginSettingTab {
  plugin: PaneSearchPlugin;

  constructor(app: App, plugin: PaneSearchPlugin) {
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
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    await this.plugin.saveSettings();
  }
}
