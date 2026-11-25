import { mock } from "bun:test";
import { testLanguage } from "./test-language";

void mock.module("obsidian", () => ({
  getLanguage: () => testLanguage.current ?? "en",
}));
