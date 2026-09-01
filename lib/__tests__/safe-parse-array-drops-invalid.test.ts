import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ProgramSchema, safeParseArray, StackingRuleSchema } from "../schemas";

/**
 * R2 finding 5a — `safeParseArray` called it "graceful degradation" and then
 * pushed the RAW, unvalidated item into a `T[]`.
 *
 * The return type is `Program[]` / `StackingRule[]`, and every caller
 * (lib/data.ts, /api/programs, /api/stacking) reads schema-guaranteed fields
 * off those values. So a record missing `summary`, or carrying a `level`
 * outside the enum, reached the report engine and the public program surfaces
 * wearing a type it had never earned — with nothing but a per-item
 * `console.warn` in a log nobody reads.
 *
 * Dropping is the honest degradation: a malformed record is not a program.
 */

const Simple = z.object({ id: z.string(), n: z.number() });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("safeParseArray drops invalid items instead of passing them through", () => {
  it("keeps the valid items and drops the invalid ones", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const parsed = safeParseArray(
      Simple,
      [{ id: "a", n: 1 }, { id: "b", n: "not a number" }, { id: "c", n: 3 }],
      "test",
    );
    expect(parsed).toEqual([{ id: "a", n: 1 }, { id: "c", n: 3 }]);
  });

  it("never returns an item that would fail the schema it was validated against", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const parsed = safeParseArray(Simple, [{ id: "a", n: 1 }, { nope: true }, null, 42], "test");
    for (const item of parsed) {
      expect(Simple.safeParse(item).success).toBe(true);
    }
    expect(parsed).toHaveLength(1);
  });

  it("logs ONE summary line naming the count and the first failure, not one line per item", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    safeParseArray(Simple, [{ bad: 1 }, { bad: 2 }, { bad: 3 }, { id: "ok", n: 0 }], "catalog");

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain("[catalog]");
    expect(message).toContain("dropped 3 of 4");
    expect(message).toMatch(/first failure/);
  });

  it("stays silent and returns everything when every item is valid", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const input = [{ id: "a", n: 1 }, { id: "b", n: 2 }];
    expect(safeParseArray(Simple, input, "clean")).toEqual(input);
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns an empty array (not the raw input) when nothing validates", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(safeParseArray(Simple, [{ junk: true }, "string", 0], "all-bad")).toEqual([]);
  });

  /** The two schemas this helper is actually used with in production. */
  it("drops a Program record whose `level` is outside the enum", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const good = { id: "p1", name: "Good", level: "city", summary: "Real program" };
    const bad = { id: "p2", name: "Bad", level: "galactic", summary: "Not a real level" };
    const parsed = safeParseArray(ProgramSchema, [good, bad], "programs");
    expect(parsed.map((p) => p.id)).toEqual(["p1"]);
  });

  it("drops a Program record missing the required `summary`", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const parsed = safeParseArray(
      ProgramSchema,
      [{ id: "p1", name: "No summary", level: "state" }],
      "programs",
    );
    expect(parsed).toEqual([]);
  });

  it("drops a StackingRule with an unknown relationship", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const base = {
      id: "s1",
      programId: "a",
      otherProgramId: "b",
      scope: "citywide",
      reason: "because",
      authoritySource: "ordinance",
      confidence: "high",
      lastVerifiedAt: null,
      conditionsJson: null,
    };
    const parsed = safeParseArray(
      StackingRuleSchema,
      [{ ...base, relationship: "can" }, { ...base, id: "s2", relationship: "maybe" }],
      "stacking",
    );
    expect(parsed.map((r) => r.id)).toEqual(["s1"]);
  });
});
