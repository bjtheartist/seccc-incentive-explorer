/**
 * lib/permit-exhibit-source.ts — the ONE indirection point between the PR2
 * surface (page, print route) and PR1's evidence spine
 * (lib/permit-exhibit.ts, feat/permit-exhibit-spine). PHASE B: wired to the
 * real `buildPermitExhibit`, rebased onto commit dc81645 of
 * feat/permit-exhibit-spine — see the joint envelope negotiation between
 * the PR1 and PR2 builders (session messages, 2026-08-25) for the two
 * documented deltas from PR2's original Phase-A assumptions:
 *   - area rows carry `locatedVia: "point" | "address_only"`, not
 *     `matchMethod` (S2 is "vs the RADIUS", a different vocabulary than
 *     S1's parcel-relative pin_parcel/address_exact/proximity).
 *   - `coverage` is `{ matchMethodBreakdown, area: { geolocatedCount,
 *     unlocatedCount, totalCount }, coverageNote }`, computed from
 *     `subject` for the match-method half and from `area.rows` for the
 *     unlocated half.
 *
 * Every page/route in this feature imports ONLY this module for data,
 * never lib/permit-exhibit.ts directly and never
 * lib/permit-exhibit-fixtures.ts directly (tests are the one exception,
 * mocking this module the same way app/vacancy/[zip]/shortlist's tests
 * mock lib/shortlist-universe).
 */

import {
  PermitExhibitBuildError,
  buildPermitExhibit,
  type PermitExhibitErrorCode,
  type PermitExhibitRadiusFt,
  type PermitExhibitResult,
} from "./permit-exhibit";

export interface LoadPermitExhibitInput {
  pin: string;
  radiusFt: number;
}

export type PermitExhibitLoadError = { kind: PermitExhibitErrorCode } | { kind: "unavailable" };

export type PermitExhibitLoadResult =
  | { ok: true; data: PermitExhibitResult }
  | { ok: false; error: PermitExhibitLoadError };

export async function loadPermitExhibit(
  input: LoadPermitExhibitInput,
): Promise<PermitExhibitLoadResult> {
  try {
    const data = await buildPermitExhibit({
      pin: input.pin,
      radiusFt: input.radiusFt as PermitExhibitRadiusFt,
    });
    return { ok: true, data };
  } catch (error) {
    if (error instanceof PermitExhibitBuildError) {
      return { ok: false, error: { kind: error.code } };
    }
    console.error("Permit exhibit build failed:", error);
    return { ok: false, error: { kind: "unavailable" } };
  }
}

/**
 * ── R2 finding 8, gate-reorder sub-item: NOT APPLIED. Deliberate. ──
 *
 * The audit asked for the access-gate check in
 * app/permit-exhibit/[pin]/page.tsx to move BEFORE `loadPermitExhibit`, so
 * ungated traffic stops driving the full upstream chain (two
 * `building_permits` queries, a live County parcel lookup, a live
 * zoning-district lookup, the zoning-archive read) for output it is not
 * allowed to see. That reading of the cost is correct.
 *
 * It cannot be done without contradicting an existing, deliberate assertion.
 * app/permit-exhibit/[pin]/__tests__/page.test.tsx pins "still renders the
 * header (address, PIN, exhibit id) even when gated" — the gated view is
 * SUPPOSED to show the exhibit header. That header needs `meta.exhibitId` and
 * `meta.snapshotDate`, both derived from the completed build
 * (`computePermitExhibitId` takes the dataset vintage), so there is no way to
 * render it without doing the work. Gate-first and header-when-gated are
 * mutually exclusive; choosing between them is a product call about what an
 * ungated visitor should see, not a defect fix.
 *
 * Left for an owner ruling rather than silently weakening the test. Note the
 * PRINT variant (app/print/permit-exhibit/[pin]/page.tsx) already gates before
 * loading — it renders `NotAuthorized` with no header, so it never had the
 * conflict.
 */
