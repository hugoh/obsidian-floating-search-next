import { getLanguage } from "obsidian";

export type Locale = "en" | "zh";

/**
 * Maps an Obsidian language code (`en`, `zh`, `zh-TW`, `ja`, ...) to a bundled
 * translation. Traditional Chinese (`zh-TW`, `zh-HK`, `zh-MO`, `zh-Hant`) is not
 * translated yet, so it gets English rather than Simplified Chinese. To add a
 * language, see "Adding a language" in CONTRIBUTING.md.
 */
export function resolveLocale(lang: string): Locale {
  const parts = lang.toLowerCase().split(/[-_]/);
  if (parts[0] === "zh") {
    const traditional = parts.some((part) =>
      ["tw", "hk", "mo", "hant"].includes(part),
    );
    return traditional ? "en" : "zh";
  }
  return "en";
}

export function getLocale(): Locale {
  return resolveLocale(getLanguage());
}

export interface Strings {
  pluginIntro: string;
  tabGeneral: string;
  showInstructions: string;
  ribbonSearch: string;
  cmdSearchGlobally: string;
  cmdSearchGloballyState: string;
  instrNavigate: string;
  instrCollapse: string;
  instrOpenAndClose: string;
  instrPreview: string;
  instrSwitchView: string;
  instrAltClick: string;
}

const EN: Strings = {
  pluginIntro:
    "Use Obsidian's built-in search in a floating modal, with a preview pane.",
  tabGeneral: "General",
  showInstructions: "Show instructions",
  ribbonSearch: "Search obsidian globally",
  cmdSearchGlobally: "Search obsidian globally",
  cmdSearchGloballyState: "Search Obsidian Globally (With Last State)",
  instrNavigate: "Navigate",
  instrCollapse: "Collapse/Expand",
  instrOpenAndClose: "Open File and Close",
  instrPreview: "Preview/Close Preview",
  instrSwitchView: "Switch Between Search and File View",
  instrAltClick: "Close Modal While In File View",
};

const ZH: Strings = {
  pluginIntro: "在带预览窗格的浮动弹窗中使用 Obsidian 自带搜索。",
  tabGeneral: "常规",
  showInstructions: "显示按键说明",
  ribbonSearch: "全局搜索",
  cmdSearchGlobally: "全局搜索",
  cmdSearchGloballyState: "全局搜索（保留上次关键字）",
  instrNavigate: "切换结果",
  instrCollapse: "折叠/展开",
  instrOpenAndClose: "打开并关闭弹窗",
  instrPreview: "预览/关闭预览",
  instrSwitchView: "在搜索和预览间切换",
  instrAltClick: "预览时关闭弹窗",
};

/** Every bundled translation, keyed by locale. */
export const TRANSLATIONS: Record<Locale, Strings> = { en: EN, zh: ZH };

export function strings(): Strings {
  return TRANSLATIONS[getLocale()];
}
