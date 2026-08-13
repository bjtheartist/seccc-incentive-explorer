import { describe, expect, it } from "vitest";
import programs from "../../public/data/programs.json";

/**
 * Catalog completeness + binding-invariant tests for the eligibility-claims
 * foundation (PR1, spec section 1.1 / 1.4). See docs/eligibility-claims-
 * acceptance.md for the full per-record derivation table.
 *
 * DERIVATION RULE (binding, build-spec.md 1.1): when a record's prose does
 * not clearly establish a value, the value must be "unknown" / "conditional"
 * — never "open" / "current". These tests assert the *shape* of that rule
 * (no lapsed/sunset/pending record claims current terms) rather than
 * re-deriving every value, since the derivation itself is a judgment call
 * recorded in the acceptance doc for human review.
 */

const VALID_INTAKE_STATUS = new Set([
  "open",
  "rolling",
  "closed",
  "lapsed",
  "pending",
  "unknown",
]);
const VALID_BENEFIT_TERMS_STATUS = new Set([
  "current",
  "historical",
  "conditional",
  "unknown",
]);
const VALID_LOCATION_RELATION = new Set([
  "required",
  "preference",
  "proxy",
  "contextual",
  "none",
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe("catalog eligibility-claims fields (every one of 71 records)", () => {
  it("has exactly 71 records", () => {
    expect(programs).toHaveLength(71);
  });

  it("every record has all five new fields with valid enum values", () => {
    for (const program of programs as Array<Record<string, unknown>>) {
      const id = String(program.id);

      expect(program.intakeStatus, `${id}.intakeStatus`).toBeTypeOf("string");
      expect(
        VALID_INTAKE_STATUS.has(program.intakeStatus as string),
        `${id}.intakeStatus = ${String(program.intakeStatus)}`
      ).toBe(true);

      expect(program.statusAsOf, `${id}.statusAsOf`).toBeTypeOf("string");
      expect(
        ISO_DATE.test(program.statusAsOf as string),
        `${id}.statusAsOf = ${String(program.statusAsOf)} is not an ISO date`
      ).toBe(true);

      expect(
        program.benefitTermsStatus,
        `${id}.benefitTermsStatus`
      ).toBeTypeOf("string");
      expect(
        VALID_BENEFIT_TERMS_STATUS.has(program.benefitTermsStatus as string),
        `${id}.benefitTermsStatus = ${String(program.benefitTermsStatus)}`
      ).toBe(true);

      expect(
        program.locationRelation,
        `${id}.locationRelation`
      ).toBeTypeOf("string");
      expect(
        VALID_LOCATION_RELATION.has(program.locationRelation as string),
        `${id}.locationRelation = ${String(program.locationRelation)}`
      ).toBe(true);

      expect(program.nextWindow, `${id}.nextWindow`).toBeTypeOf("object");
      const nextWindow = program.nextWindow as Record<string, unknown>;
      expect(
        nextWindow.expected === null || typeof nextWindow.expected === "string",
        `${id}.nextWindow.expected`
      ).toBe(true);
      expect(
        nextWindow.note === null || typeof nextWindow.note === "string",
        `${id}.nextWindow.note`
      ).toBe(true);
    }
  });

  it("no record with status lapsed/sunset/pending claims benefitTermsStatus current", () => {
    const violations: string[] = [];
    for (const program of programs as Array<Record<string, unknown>>) {
      const status = program.status as string | undefined;
      if (status === "lapsed" || status === "sunset" || status === "pending") {
        if (program.benefitTermsStatus === "current") {
          violations.push(String(program.id));
        }
      }
    }
    expect(violations, `records violating the binding invariant: ${violations.join(", ")}`).toEqual([]);
  });

  it("no record with status lapsed/sunset/pending claims intakeStatus open", () => {
    const violations: string[] = [];
    for (const program of programs as Array<Record<string, unknown>>) {
      const status = program.status as string | undefined;
      if (status === "lapsed" || status === "sunset" || status === "pending") {
        if (program.intakeStatus === "open") {
          violations.push(String(program.id));
        }
      }
    }
    expect(violations, `records violating the binding invariant: ${violations.join(", ")}`).toEqual([]);
  });

  it("MUTATION TEST: flipping a lapsed record's benefitTermsStatus to current is caught by the invariant check above", () => {
    // Proves the invariant test above is not vacuous — it actually fails on
    // a mutated fixture that violates the binding rule.
    const mutated = (programs as Array<Record<string, unknown>>).map((p) =>
      p.id === "catalystGrant" ? { ...p, benefitTermsStatus: "current" } : p
    );
    const violations = mutated.filter(
      (p) =>
        (p.status === "lapsed" || p.status === "sunset" || p.status === "pending") &&
        p.benefitTermsStatus === "current"
    );
    expect(violations.length).toBeGreaterThan(0);
  });

  describe("binding spec anchors (build-spec.md 1.1)", () => {
    const byId = new Map(
      (programs as Array<Record<string, unknown>>).map((p) => [p.id as string, p])
    );

    it("catalystGrant: lapsed / historical, window closed 2025-11-14, no round anticipated 2026-27", () => {
      const p = byId.get("catalystGrant")!;
      expect(p.intakeStatus).toBe("lapsed");
      expect(p.benefitTermsStatus).toBe("historical");
      const nextWindow = p.nextWindow as { expected: string | null; note: string | null };
      expect(nextWindow.expected).toBeNull();
      expect(nextWindow.note).toMatch(/2025-11-14/);
      expect(nextWindow.note).toMatch(/2026|2027/);
    });

    it("edaBuildToScale: pending / historical, no announced NOFO", () => {
      const p = byId.get("edaBuildToScale")!;
      expect(p.intakeStatus).toBe("pending");
      expect(p.benefitTermsStatus).toBe("historical");
      const nextWindow = p.nextWindow as { note: string | null };
      expect(nextWindow.note).toMatch(/NOFO/i);
    });

    it("microMarketRecovery (CNRP): closed, $15,000 homeownership", () => {
      const p = byId.get("microMarketRecovery")!;
      expect(p.intakeStatus).toBe("closed");
      expect(p.benefitRange).toMatch(/\$15,000/);
    });

    it("highUnemployment (WOTC): lapsed", () => {
      const p = byId.get("highUnemployment")!;
      expect(p.intakeStatus).toBe("lapsed");
    });

    it("chips48d: 35%", () => {
      const p = byId.get("chips48d")!;
      expect(p.benefitRange).toMatch(/35%/);
    });
  });
});
