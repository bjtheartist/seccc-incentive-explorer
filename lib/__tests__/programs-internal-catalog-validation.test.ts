import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetCatalogValidationForTests,
  assertProgramCatalogValid,
  getProgramsSync,
} from "../programs-data";

/**
 * R2 finding 5b — the INTERNAL catalog was read off disk and cast, never
 * validated.
 *
 * `getProgramsSync()` was `require("../data/programs-internal.json") as
 * Program[]`. The public/static path through `safeParseArray` was validated;
 * this one — the catalog that actually feeds report generation, the
 * confidence engine, and every program surface — was not. A malformed
 * committed record (missing `summary`, a `level` outside the enum) flowed
 * straight through wearing the `Program` type.
 *
 * The fix validates once per process and fails differently by environment:
 * dev/test THROW so CI catches a bad catalog at the first test that loads
 * programs; production logs loudly and continues, because refusing to serve
 * any report because one of ~71 records has a bad field is a worse outage
 * than serving the other 70.
 */

const GOOD = { id: "good", name: "Good Program", level: "city", summary: "A real one" };
const BAD_CATALOG = [
  GOOD,
  { id: "bad-level", name: "Bad", level: "galactic", summary: "Level is not in the enum" },
  { id: "no-summary", name: "Also Bad", level: "state" },
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  __resetCatalogValidationForTests();
});

describe("the REAL committed catalog", () => {
  it("passes ProgramSchema — getProgramsSync() does not throw", () => {
    __resetCatalogValidationForTests();
    expect(() => getProgramsSync()).not.toThrow();
    expect(getProgramsSync().length).toBeGreaterThan(0);
  });

  it("is validated by the same function the guard calls, with no failures", () => {
    expect(() => assertProgramCatalogValid(getProgramsSync())).not.toThrow();
  });

  it("validates only ONCE per process, not on every call", () => {
    __resetCatalogValidationForTests();
    const first = getProgramsSync();
    const second = getProgramsSync();
    // Same require cache, same array identity — no re-walk of ~71 records.
    expect(second).toBe(first);
  });
});

describe("a malformed catalog", () => {
  it("THROWS in test/dev so CI catches a bad committed catalog", () => {
    expect(() => assertProgramCatalogValid(BAD_CATALOG)).toThrow(/programs-internal/);
  });

  it("names the offending record ids and the failing field", () => {
    let message = "";
    try {
      assertProgramCatalogValid(BAD_CATALOG);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("2 of 3");
    expect(message).toContain("bad-level");
    expect(message).toContain("no-summary");
    expect(message).toContain("summary");
  });

  it("in PRODUCTION logs loudly and continues rather than taking the app down", () => {
    vi.stubEnv("NODE_ENV", "production");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => assertProgramCatalogValid(BAD_CATALOG)).not.toThrow();

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain("2 of 3");
  });

  it("rejects a catalog that is not an array at all", () => {
    expect(() => assertProgramCatalogValid({ nope: true })).toThrow(/not an array/);
    expect(() => assertProgramCatalogValid(null)).toThrow(/not an array/);
  });

  it("accepts a fully valid catalog silently", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => assertProgramCatalogValid([GOOD])).not.toThrow();
    expect(error).not.toHaveBeenCalled();
  });
});
