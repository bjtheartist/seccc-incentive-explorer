import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ExemptionReferralFile } from "../exemption-anomalies";

// The PRIVATE referral packet (data/private/exemption-anomalies.json) ships
// committed-private, exactly like data/private/owner-clusters-geo.json. These
// guards stay skipped until the orchestrator runs the exemption overlay and
// commits the packet; then they hard-run — mirroring the committed-export guards
// in vacancy-index.test.ts.

const REFERRAL_PATH = path.join(process.cwd(), "data/private/exemption-anomalies.json");
const REFERRAL_EXISTS = existsSync(REFERRAL_PATH);

describe.skipIf(!REFERRAL_EXISTS)("committed exemption-anomalies.json (private referral packet)", () => {
  const data = REFERRAL_EXISTS
    ? (JSON.parse(readFileSync(REFERRAL_PATH, "utf8")) as ExemptionReferralFile)
    : ({ generatedAt: "", taxYear: 0, byZip: {} } as ExemptionReferralFile);

  it("carries NO owner-identifying substring (owner name / mailing / taxpayer)", () => {
    const serialized = JSON.stringify(data);
    for (const forbidden of [
      "ownerName",
      "owner_name",
      "ownerMailingAddress",
      "owner_mailing_address",
      "taxpayer",
    ]) {
      expect(serialized.includes(forbidden), `forbidden substring present: ${forbidden}`).toBe(false);
    }
  });

  it("keys byZip on 5-digit ZIPs and every row is well-formed", () => {
    expect(Number.isInteger(data.taxYear)).toBe(true);
    for (const [zip, rows] of Object.entries(data.byZip)) {
      expect(/^\d{5}$/.test(zip), `zip key ${zip}`).toBe(true);
      for (const r of rows) {
        // 14-digit digits-only PIN.
        expect(/^\d{14}$/.test(r.pin), `pin ${r.pin}`).toBe(true);
        // Universe is exactly one of the two.
        expect(["land", "building"]).toContain(r.universe);
        // Exemptions object carries the six numeric EAV fields, all nonneg.
        for (const k of ["homeowner", "senior", "freeze", "disabled", "vet", "longtime"] as const) {
          expect(typeof r.exemptions[k]).toBe("number");
          expect(r.exemptions[k]).toBeGreaterThanOrEqual(0);
        }
        // Every referral row is an actual anomaly (≥1 occupancy exemption > 0).
        const anyExemption = Object.values(r.exemptions).some((v) => v > 0);
        expect(anyExemption, `row ${r.pin} has no occupancy exemption`).toBe(true);
        // Transfer date is null or an ISO-ish YYYY-MM-DD.
        expect(r.latestTransferDate === null || /^\d{4}-\d{2}-\d{2}$/.test(r.latestTransferDate)).toBe(true);
        expect(Number.isInteger(r.taxYear)).toBe(true);
      }
    }
  });
});
