import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("release workflow", () => {
  test("uploads every file Obsidian installs from a release", () => {
    const upload = workflow
      .split("\n")
      .find((line) => line.includes("gh release upload"));
    expect(upload).toBeDefined();
    for (const file of ["main.js", "manifest.json", "styles.css"]) {
      expect(upload).toContain(file);
    }
  });

  test("the stylesheet it uploads exists", () => {
    expect(existsSync("styles.css")).toBe(true);
  });

  test("runs the whole test suite before publishing", () => {
    expect(workflow).toContain("bun run test");
  });
});
