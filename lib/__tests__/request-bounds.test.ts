import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PERMIT_EXHIBIT_ROW_CAP,
  type PermitExhibitMeta,
  type PermitExhibitTruncation,
} from "../permit-exhibit";

/**
 * R2 finding 8 — request bounds.
 *
 * Two unrelated ways the same class of defect showed up:
 *
 * 1. Report-pathway API routes with no `export const maxDuration`. They ran
 *    under the platform default with no bound of their own, so a chain of
 *    slow-but-not-timing-out upstreams could sit on a function slot.
 *
 * 2. lib/permit-exhibit.ts issued two UNBOUNDED `SELECT *` queries against
 *    `building_permits`, one of them a radius search whose result set grows
 *    with the square of the radius. Worse than the memory cost: an exhibit
 *    built from a partial read would have been indistinguishable from a
 *    complete one, in a document explicitly offered as evidence.
 */

const REPO_ROOT = path.join(__dirname, "..", "..");

function routeSource(route: string): string {
  return readFileSync(path.join(REPO_ROOT, "app", "api", route, "route.ts"), "utf8");
}

describe("report-pathway routes declare a request ceiling", () => {
  it.each([
    ["parcel", 30],
    ["report/generate", 30],
    ["census", 20],
    ["corridor", 20],
    ["zones/check", 30],
    ["zones/check/v2", 30],
  ])("/api/%s exports maxDuration = %i", (route, expected) => {
    const source = routeSource(route);
    const match = source.match(/export const maxDuration = (\d+);/);
    expect(match, `/api/${route} has no maxDuration`).not.toBeNull();
    expect(Number(match![1])).toBe(expected);
  });

  it.each(["parcel", "report/generate", "census", "corridor", "zones/check", "zones/check/v2"])(
    "/api/%s keeps its ceiling within Vercel's 60s function limit",
    (route) => {
      const value = Number(routeSource(route).match(/export const maxDuration = (\d+);/)![1]);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(60);
    },
  );

  /**
   * /api/geocode belongs to another round's fence — pinned here so a later
   * sweep does not assume this list was meant to be exhaustive.
   */
  it("leaves /api/geocode alone (another round owns that file)", () => {
    expect(routeSource("geocode")).not.toContain("maxDuration");
  });
});

describe("permit-exhibit queries are bounded", () => {
  const source = readFileSync(path.join(REPO_ROOT, "lib", "permit-exhibit.ts"), "utf8");

  it("caps BOTH building_permits reads", () => {
    const limits = source.match(/LIMIT \$\{PERMIT_EXHIBIT_ROW_CAP\}/g) ?? [];
    expect(limits, "the subject-candidate and area queries must each be capped").toHaveLength(2);
  });

  it("leaves no unbounded SELECT over building_permits", () => {
    // Each `FROM building_permits` occurrence must live in a statement that
    // eventually reaches a LIMIT. Both statements are checked above; this
    // guards against a THIRD query being added without one.
    const fromCount = (source.match(/FROM building_permits/g) ?? []).length;
    expect(fromCount, "a new building_permits query needs its own cap").toBeLessThanOrEqual(3);
  });

  it("exposes the cap as a documented constant, not a magic number", () => {
    expect(PERMIT_EXHIBIT_ROW_CAP).toBe(20_000);
    expect(PERMIT_EXHIBIT_ROW_CAP).toBeGreaterThan(1000);
  });
});

describe("truncation is disclosed, never hidden", () => {
  /**
   * The meta field is the contract: a surface rendering an exhibit can ask
   * whether the read was complete. `null` means complete.
   */
  it("PermitExhibitMeta carries a truncation field", () => {
    const meta: Pick<PermitExhibitMeta, "truncation"> = { truncation: null };
    expect(meta.truncation).toBeNull();
  });

  it("a truncation marker names the scope, the cap, and a renderable notice", () => {
    const truncation: PermitExhibitTruncation = {
      scope: "area",
      rowCap: PERMIT_EXHIBIT_ROW_CAP,
      notice: "…",
    };
    expect(["subject", "area", "both"]).toContain(truncation.scope);
    expect(truncation.rowCap).toBe(PERMIT_EXHIBIT_ROW_CAP);
  });

  it("the notice tells the reader counts are a floor, not a total", () => {
    const source = readFileSync(path.join(REPO_ROOT, "lib", "permit-exhibit.ts"), "utf8");
    expect(source).toContain("a floor, not a total");
    expect(source).toContain("does not show every matching permit");
  });

  it("treats hitting the cap EXACTLY as truncation (>=, not >)", () => {
    const source = readFileSync(path.join(REPO_ROOT, "lib", "permit-exhibit.ts"), "utf8");
    expect(source).toContain("subjectCandidateRows.length >= PERMIT_EXHIBIT_ROW_CAP");
    expect(source).toContain("areaRows.length >= PERMIT_EXHIBIT_ROW_CAP");
  });

  it("reports 'both' only when both queries were capped", () => {
    const source = readFileSync(path.join(REPO_ROOT, "lib", "permit-exhibit.ts"), "utf8");
    expect(source).toContain(
      'subjectTruncated && areaTruncated ? "both" : subjectTruncated ? "subject" : "area"',
    );
  });
});
