import { describe, expect, it, vi } from "vitest";
import programs from "../../public/data/programs.json";
import { ProgramSchema, safeParseArray } from "../schemas";

const PRESERVED_FIELDS = [
  "status",
  "documentSpecs",
  "deadlines",
  "oneTime",
  "expiresOn",
  "recurring",
  "personas",
  "contacts",
  "verificationSteps",
  "sourceUrl",
  "lastVerifiedAt",
  "redesignatedAreaWarning",
  "adjacentCapitalNote",
] as const;

describe("production program schema", () => {
  it("parses every production program without raw-data fallback", () => {
    for (const program of programs) {
      const result = ProgramSchema.safeParse(program);
      expect(result.success, `program ${program.id}`).toBe(true);
    }
  });

  it("preserves every modeled transparency and availability field", () => {
    for (const program of programs as Array<Record<string, unknown>>) {
      const parsed = ProgramSchema.parse(program) as Record<string, unknown>;

      for (const field of PRESERVED_FIELDS) {
        if (Object.hasOwn(program, field)) {
          expect(parsed[field], `${String(program.id)}.${field}`).toEqual(program[field]);
        }
      }
    }
  });

  it("does not warn or fall back when parsing the production catalog", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const parsed = safeParseArray(ProgramSchema, programs, "programs-test");

    expect(parsed).toHaveLength(programs.length);
    expect(warning).not.toHaveBeenCalled();
    warning.mockRestore();
  });
});
