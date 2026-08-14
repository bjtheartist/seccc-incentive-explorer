import { describe, expect, it } from "vitest";
import {
  loadShortlistUniverseManifest,
  loadShortlistUniverse,
} from "@/lib/shortlist-universe";
import { overlaysText, incentiveCountText } from "@/components/vacancy/SiteShortlistResults";

/**
 * review6 S12 (CRITICAL): the coordinator's TEST requirement verbatim —
 * "load the ACTUAL committed export files through the production schema"
 * (no synthetic fixtures, no `__setShortlistUniverseDataDirForTests`
 * override — this file never calls it, so `loadShortlistUniverse` reads
 * the real `data/exports/shortlist-universe/*.json`) — "and assert legacy
 * false overlays, null counts, zero counts never render 'None
 * mapped'/'0 … mapped'; known positives stay visible."
 *
 * Context: every one of the 9 committed files predates the `unknown`
 * overlay field and the audited-`incentiveCount` distinction — confirmed
 * by direct inspection (0 of 125,184 overlay objects across all 9 files
 * carry an explicit `unknown` key; 12,216 of 31,296 rows carry
 * `incentiveCount: null`, 0 carry a literal `0`, the remainder are
 * positive). Before this finding's fix
 * (lib/shortlist-universe-schema.ts's `OverlayMembershipSchema` and
 * lib/shortlist-engine.ts's `incentiveCount: row.incentiveCount ?? 0`),
 * loading these exact files would have silently promoted every omitted
 * `unknown` to a trusted `false` and every `null` count to a trusted `0`
 * — this test loads the real files AFTER the fix and proves that no
 * longer happens.
 */
describe("Site Shortlist legacy committed export files — S12 rendering safety", () => {
  const manifest = loadShortlistUniverseManifest();

  it("the real manifest loads and lists at least one ZIP (sanity check — a broken loader would make every assertion below vacuously pass)", () => {
    expect(manifest).not.toBeNull();
    expect(manifest!.zips.length).toBeGreaterThan(0);
  });

  const zips = manifest?.zips ?? [];
  if (zips.length === 0) {
    it.skip("no committed universe files available in this environment — skipping the real-file scan", () => {});
  }

  for (const zip of zips) {
    describe(`ZIP ${zip}`, () => {
      const result = loadShortlistUniverse(zip);

      it("loads successfully through the real, unmodified loader + production schema", () => {
        expect(result.ok).toBe(true);
      });

      if (!result.ok) return;

      const { rows } = result.data;

      it(`has rows to actually exercise (${rows.length} rows)`, () => {
        expect(rows.length).toBeGreaterThan(0);
      });

      it("no row's overlaysText() output is the confirmed-absence string 'None mapped' — every legacy row is either a known positive or 'Not checked'", () => {
        for (const row of rows) {
          const text = overlaysText(row.overlays);
          expect(text, `${row.canonicalKey}: "${text}"`).not.toBe("None mapped");
          // The "None confirmed" partial-form (used only alongside at least
          // one genuinely-unknown layer, never alone) is fine — only the
          // bare "None mapped" confirmed-absence claim is forbidden.
        }
      });

      it("every overlay explicitly present:true in the committed file renders as a known positive (never swallowed by the unknown-legacy fix)", () => {
        let checkedAtLeastOne = false;
        for (const row of rows) {
          for (const key of ["ssa", "ccsa", "tif", "nof"] as const) {
            const membership = row.overlays[key];
            if (!membership.present) continue;
            checkedAtLeastOne = true;
            // A present:true legacy row must be TRUSTED (unknown: false)
            // per S12's directive ("present:true stays trusted"), not
            // reclassified as unchecked merely because the file predates
            // the `unknown` field.
            expect(membership.unknown, `${row.canonicalKey}.${key}`).toBe(false);
            const text = overlaysText(row.overlays);
            expect(text, `${row.canonicalKey}: "${text}"`).not.toBe("Not checked");
            expect(text, `${row.canonicalKey}: "${text}"`).not.toBe("None mapped");
          }
        }
        // Every ZIP in this citywide export has at least some SSA/TIF/NOF
        // coverage — if this ever trips, the loop above tested nothing.
        expect(checkedAtLeastOne).toBe(true);
      });

      it("every overlay explicitly present:false in the committed file (the legacy-omitted-unknown case) reads as unchecked, not confirmed absent", () => {
        let checkedAtLeastOne = false;
        for (const row of rows) {
          for (const key of ["ssa", "ccsa", "tif", "nof"] as const) {
            const membership = row.overlays[key];
            if (membership.present) continue;
            checkedAtLeastOne = true;
            // review6 S12: an omitted `unknown` on a `present: false`
            // legacy row must fail closed as "never checked" (true), not
            // silently become a trusted confirmed non-match (false).
            expect(membership.unknown, `${row.canonicalKey}.${key}`).toBe(true);
          }
        }
        expect(checkedAtLeastOne).toBe(true);
      });

      it("no row's incentiveCountText() ever claims '0 incentive geographies mapped' — null counts read as not-checked, and (defensively) so would a literal zero", () => {
        let sawNull = false;
        for (const row of rows) {
          const text = incentiveCountText(row.incentiveCount);
          expect(text, `${row.canonicalKey}: incentiveCount=${row.incentiveCount}`).not.toMatch(
            /^0 incentive/,
          );
          if (row.incentiveCount === null) {
            sawNull = true;
            expect(text).toBe("Incentive geography count not checked");
          }
        }
        // This ZIP's committed file must actually contain at least one
        // unresolved (`null`) count, or the assertion above tested nothing
        // for this ZIP — every one of the 9 files does (12,216 across all
        // 9, confirmed by direct inspection).
        expect(sawNull).toBe(true);
      });

      it("every positive incentiveCount (a genuine, non-legacy-ambiguous fact) still renders the real number — the fix does not hide known positives", () => {
        let sawPositive = false;
        for (const row of rows) {
          if (row.incentiveCount == null || row.incentiveCount <= 0) continue;
          sawPositive = true;
          const text = incentiveCountText(row.incentiveCount);
          expect(text, row.canonicalKey).toContain(String(row.incentiveCount));
          expect(text, row.canonicalKey).toContain("mapped at this point");
        }
        expect(sawPositive).toBe(true);
      });
    });
  }
});

/**
 * Synthetic, in-memory control case for a literal `incentiveCount: 0` —
 * every committed file today happens to carry only `null` or positive
 * counts (confirmed above, zero real `0`s to exercise), so this proves
 * the "do NOT trust legacy zeros" half of S12's directive against a
 * value the real files don't currently contain, using the exact same
 * `incentiveCountText` the real-file tests above call.
 */
describe("incentiveCountText — synthetic zero control (S12: 'null OR zero renders Not checked')", () => {
  it("a literal 0 renders the same 'not checked' text as null, not '0 incentive geographies mapped'", () => {
    expect(incentiveCountText(0)).toBe("Incentive geography count not checked");
    expect(incentiveCountText(0)).toBe(incentiveCountText(null));
  });

  it("a positive count still renders the real number and correct pluralization", () => {
    expect(incentiveCountText(1)).toBe("1 incentive geography mapped at this point");
    expect(incentiveCountText(2)).toBe("2 incentive geographies mapped at this point");
  });
});
