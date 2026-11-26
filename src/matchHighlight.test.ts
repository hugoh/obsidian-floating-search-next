import { describe, expect, test } from "bun:test";
import { matchedTerms } from "./matchHighlight";

describe("matchedTerms", () => {
  test("reads the matched text out of the row content", () => {
    expect(
      matchedTerms({ content: "A tropical Pineapple.", matches: [[11, 20]] }),
    ).toEqual(["pineapple"]);
  });

  test("lists each distinct term once, whatever its case", () => {
    const content = "Kiwi and kiwi and plum";
    expect(
      matchedTerms({
        content,
        matches: [
          [0, 4],
          [9, 13],
          [18, 22],
        ],
      }),
    ).toEqual(["kiwi", "plum"]);
  });

  test("ignores a missing, empty or malformed match", () => {
    expect(matchedTerms(undefined)).toEqual([]);
    expect(matchedTerms({ content: "text" })).toEqual([]);
    expect(matchedTerms({ content: "text", matches: [] })).toEqual([]);
    expect(
      matchedTerms({ content: "a b", matches: [[1, 2], "x", [0], [5, 9]] }),
    ).toEqual([]);
  });
});
