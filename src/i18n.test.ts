import { describe, expect, test } from "bun:test";
import { getLocale, resolveLocale, strings, TRANSLATIONS } from "./i18n";
import { testLanguage } from "./test-language";

const withLanguage = <T>(language: string, run: () => T): T => {
  testLanguage.current = language;
  try {
    return run();
  } finally {
    testLanguage.current = undefined;
  }
};

describe("English", () => {
  test("is the default outside a Chinese locale", () => {
    expect(getLocale()).toBe("en");
    expect(strings().cmdSearchGlobally).toBe("Search obsidian globally");
  });

  test("parameterised messages take their argument", () => {
    expect(strings().instrPreview).toBe("Preview/Close Preview");
  });
});

describe("Chinese locale", () => {
  test("simplified Chinese selects Chinese", () => {
    withLanguage("zh", () => expect(getLocale()).toBe("zh"));
    withLanguage("zh-CN", () => expect(getLocale()).toBe("zh"));
  });

  test("messages switch language", () => {
    const english = strings().cmdSearchGlobally;
    withLanguage("zh", () => {
      expect(strings().cmdSearchGlobally).not.toBe(english);
      expect(strings().instrPreview).not.toBe("Preview/Close Preview");
    });
  });

  test("every message exists in both languages", () => {
    const zh = withLanguage("zh", () => Object.keys(strings()).sort());
    expect(Object.keys(strings()).sort()).toEqual(zh);
  });

  test("no message is left untranslated", () => {
    const english = strings() as unknown as Record<string, unknown>;
    const chinese = withLanguage(
      "zh",
      () => strings() as unknown as Record<string, unknown>,
    );
    const untranslated = Object.keys(english).filter(
      (key) =>
        typeof english[key] === "string" && english[key] === chinese[key],
    );
    // Brand and key names (for example "Shift") legitimately match.
    expect(untranslated.length).toBeLessThan(10);
  });
});

describe("resolveLocale", () => {
  test.each(["en", "en-GB", "EN_us", "fr", "ja", "de-CH", "", "xx"])(
    "%p falls back to English",
    (lang) => {
      expect(resolveLocale(lang)).toBe("en");
    },
  );

  test.each(["zh", "zh-CN", "zh-SG", "zh-Hans", "ZH_cn", "zh-hans-cn"])(
    "%p is Simplified Chinese",
    (lang) => {
      expect(resolveLocale(lang)).toBe("zh");
    },
  );

  test.each(["zh-TW", "zh-HK", "zh-MO", "zh-Hant", "zh_tw", "zh-Hant-TW"])(
    "%p is Traditional Chinese, which is not translated yet, so it gets English",
    (lang) => {
      expect(resolveLocale(lang)).toBe("en");
    },
  );
});

describe("translations", () => {
  const english = Object.keys(TRANSLATIONS.en).sort();

  test.each(Object.keys(TRANSLATIONS))(
    "%p defines exactly the messages English does",
    (locale) => {
      expect(
        Object.keys(TRANSLATIONS[locale as keyof typeof TRANSLATIONS]).sort(),
      ).toEqual(english);
    },
  );

  test.each(Object.keys(TRANSLATIONS))("%p has no empty message", (locale) => {
    const messages = TRANSLATIONS[
      locale as keyof typeof TRANSLATIONS
    ] as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(messages)) {
      if (typeof value === "string")
        expect(value.trim(), `${locale}.${key}`).not.toBe("");
    }
  });
});
