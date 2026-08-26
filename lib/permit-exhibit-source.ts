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
