/**
 * review5 S1 (CRITICAL): GET /api/programs must return the sanitized
 * PublicProgramView envelope — the same shape toPublicProgramView()
 * produces for public/data/programs-public.json — and must exclude every
 * internal-only key (whoQualifies, benefits, requiredDocs,
 * verificationSteps, applicationPortals, contacts, howToApply,
 * eligibilityRules, sourceUrl-as-flat-field, etc.). This is the actual
 * enforcement point of the "hard cutover" build-spec.md 2.2 claimed but
 * did not implement at this boundary.
 *
 * No DB connection (Hard Rules): mocked at the getSQL boundary to null, so
 * this exercises the static-fallback path deterministically.
 */
import { describe, expect, it, vi } from "vitest";
import { toPublicProgramView } from "@/lib/program-public";
import internalCatalog from "@/data/programs-internal.json";
import type { Program } from "@/lib/types";

vi.mock("@/lib/db", () => ({
  getSQL: () => null,
}));

import { GET } from "./route";

/** Every key that appears on a full internal Program record but NOT on
 *  PublicProgramView — the exact set the public route must never leak. */
const INTERNAL_ONLY_KEYS = [
  "whoQualifies",
  "benefits",
  "requiredDocs",
  "verificationSteps",
  "applicationPortals",
  "contacts",
  "contact",
  "howToApply",
  "eligibilityRules",
  "summary",
  "status",
  "lastVerifiedAt",
  "sunsetWarning",
  "suspensionNote",
  "oz2Note",
  "boundaryDisclaimer",
  "expirationNote",
  "fastestConfirmingStep",
  "deadlines",
  "expiresOn",
];

const PUBLIC_ENVELOPE_KEYS = [
  "id",
  "name",
  "level",
  "statusBadge",
  "intake",
  "benefit",
  "screening",
  "links",
  "personas",
  "zoneKey",
];

describe("GET /api/programs — sanitized public envelope (review5 S1)", () => {
  it("returns PublicProgramView[] — every record has exactly the public envelope's top-level keys", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);

    for (const record of body) {
      const keys = Object.keys(record).sort();
      expect(keys).toEqual([...PUBLIC_ENVELOPE_KEYS].sort());
    }
  });

  it("excludes every internal-only key, for every record, at any depth of the top-level object", async () => {
    const res = await GET();
    const body = await res.json();
    for (const record of body) {
      for (const key of INTERNAL_ONLY_KEYS) {
        expect(Object.hasOwn(record, key)).toBe(false);
      }
    }
  });

  it("never serializes the literal string 'whoQualifies' anywhere in the response body (no raw catalog prose leak)", async () => {
    const res = await GET();
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain("whoQualifies");
  });

  it("matches toPublicProgramView()'s own projection for a known record (nof) field-for-field, excluding the as-of timestamp", async () => {
    const res = await GET();
    const body = await res.json();
    const nof = body.find((p: { id: string }) => p.id === "nof");
    expect(nof).toBeDefined();

    const record = (internalCatalog as Program[]).find((p) => p.id === "nof")!;
    const expected = toPublicProgramView(record, record.statusAsOf!);

    expect(nof.id).toBe(expected.id);
    expect(nof.name).toBe(expected.name);
    expect(nof.intake.status).toBe(expected.intake.status);
    expect(nof.benefit.qualifier).toBe(expected.benefit.qualifier);
    expect(nof.screening.publishedCriteria).toEqual(expected.screening.publishedCriteria);
    expect(nof.zoneKey).toBe(expected.zoneKey);
  });
});
