// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { loadCommunityInvestment } from "@/lib/community-investment";
import { isRecordSaved, readShortlist, toggleShortlistRecord } from "@/components/investment/local-store";

/**
 * Deliverable 4 — "PR1 preserved IDs; verify local-store saved ids still
 * resolve (test with a fixture id from the pre-PR1 baseline)."
 *
 * PR1 (data/curated/investment-inputs, community-investment.ts) added a
 * content-derived `stableId` for foundation rows, but deliberately kept the
 * legacy positional `id` (e.g. "foundation-6") unchanged for backward
 * compatibility — the audit's own concrete example was two identical $1M
 * Arie Crown → START EARLY rows becoming `foundation-6` and `foundation-7`.
 * An admin who saved "foundation-6" to their working-set shortlist BEFORE
 * PR1 must still have that id resolve to the SAME logical grant after PR1's
 * regeneration, not a renumbered/different one and not a 404.
 *
 * "foundation-6" is a real id verified present in the committed
 * data/private/community-investment.json at PR2's base commit (9758228):
 * recipient "START EARLY", funder "Arie and Ida Crown Memorial",
 * stableId "9f373a43e7dd1454" — i.e. PR1 shipped BOTH ids side by side, not
 * a replacement.
 */
const LEGACY_ID = "foundation-6";
const EXPECTED_RECIPIENT = "START EARLY";
const EXPECTED_FUNDER = "Arie and Ida Crown Memorial";

describe("saved-items compatibility across PR1's identity change", () => {
  it("the pre-PR1 baseline id is still present in the current committed export, pointing at the SAME grant", () => {
    const data = loadCommunityInvestment();
    expect(data).not.toBeNull();
    const record = data!.records.find((r) => r.id === LEGACY_ID);
    expect(record, `expected ${LEGACY_ID} to still exist in the committed export`).toBeDefined();
    expect(record!.recipient).toBe(EXPECTED_RECIPIENT);
    expect(record!.funderName).toBe(EXPECTED_FUNDER);
    // PR1 added stable identity ALONGSIDE the legacy id — not instead of it.
    expect(record!.stableId).toBeTruthy();
    expect(record!.stableId).not.toBe(LEGACY_ID);
  });

  describe("local-store shortlist resolves a pre-PR1 saved id", () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    it("a shortlist entry saved under the legacy id round-trips through readShortlist/isRecordSaved", () => {
      // Simulates an admin who saved this record to their working set BEFORE
      // PR1 shipped stableId — the shortlist only ever stored `id`.
      toggleShortlistRecord({
        id: LEGACY_ID,
        recipient: EXPECTED_RECIPIENT,
        funderName: EXPECTED_FUNDER,
        source: "foundation",
        governmentFundingPurpose: null,
        year: 2023,
        amountAwarded: 1_000_000,
        communityArea: "Near West Side",
      });

      expect(isRecordSaved(LEGACY_ID)).toBe(true);
      const saved = readShortlist().find((r) => r.id === LEGACY_ID);
      expect(saved).toBeDefined();
      expect(saved!.recipient).toBe(EXPECTED_RECIPIENT);

      // The live dataset record under that SAME id still describes the same
      // grant, so the saved row is not a stale reference to a renumbered record.
      const liveRecord = loadCommunityInvestment()!.records.find((r) => r.id === LEGACY_ID)!;
      expect(saved!.recipient).toBe(liveRecord.recipient);
      expect(saved!.funderName).toBe(liveRecord.funderName);
    });

    it("toggling the same legacy id again removes it (round-trip both directions)", () => {
      const record = {
        id: LEGACY_ID,
        recipient: EXPECTED_RECIPIENT,
        funderName: EXPECTED_FUNDER,
        source: "foundation",
        governmentFundingPurpose: null,
        year: 2023,
        amountAwarded: 1_000_000,
        communityArea: "Near West Side",
      };
      toggleShortlistRecord(record);
      expect(isRecordSaved(LEGACY_ID)).toBe(true);
      toggleShortlistRecord(record);
      expect(isRecordSaved(LEGACY_ID)).toBe(false);
    });
  });
});
