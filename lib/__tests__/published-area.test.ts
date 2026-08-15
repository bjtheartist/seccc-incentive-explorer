import { describe, expect, it } from "vitest";
import { normalizePublishedArea } from "../published-area";

describe("normalizePublishedArea", () => {
  it.each([
    [null, null],
    [undefined, null],
    [0, null],
    [-1, null],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
    [Number.NEGATIVE_INFINITY, null],
    ["", null],
    ["not-a-number", null],
    [0.25, 0.25],
    [3125, 3125],
    ["4500", 4500],
  ])("normalizes %p to %p", (input, expected) => {
    expect(normalizePublishedArea(input)).toBe(expected);
  });
});
