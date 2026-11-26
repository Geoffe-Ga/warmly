import { describe, expect, it } from "vitest";

import { sameValue } from "../../../src/domain/same";

describe("whether two plain values say the same thing", () => {
  it("ignores the order of an object's keys, at any depth", () => {
    expect(
      sameValue(
        { a: 1, b: { c: "x", d: [1, 2] } },
        { b: { d: [1, 2], c: "x" }, a: 1 },
      ),
    ).toBe(true);
  });

  it("keeps the order of a list", () => {
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue([{ a: 1 }], [{ a: 1 }])).toBe(true);
  });

  it.each([
    ["a different value", { a: 1 }, { a: 2 }],
    ["a missing key", { a: 1, b: 2 }, { a: 1 }],
    ["an extra key", { a: 1 }, { a: 1, b: 2 }],
    [
      "a key set on one side and undefined on the other",
      { a: 1 },
      { a: undefined },
    ],
    ["a list and an object", [], {}],
    ["nothing and an object", null, {}],
    ["text and a number", "1", 1],
    ["a longer list", [1], [1, 2]],
  ])("tells %s apart", (_name, left, right) => {
    expect(sameValue(left, right)).toBe(false);
    expect(sameValue(right, left)).toBe(false);
  });

  it("takes a key that holds undefined as not being there, as after storing and reading back", () => {
    const record = { a: 1, b: undefined, c: [{ d: undefined, e: "x" }] };
    expect(sameValue(record, JSON.parse(JSON.stringify(record)))).toBe(true);
    expect(sameValue({ a: undefined }, {})).toBe(true);
    expect(sameValue({}, { b: undefined })).toBe(true);
  });

  it("takes the same thing as the same", () => {
    const value = { a: [1, { b: null }] };
    expect(sameValue(value, value)).toBe(true);
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue("x", "x")).toBe(true);
  });
});
