/**
 * lib/permit-exhibit-source.ts — the ONE indirection point between the PR2
 * surface (this branch, feat/permit-exhibit-surface) and PR1's evidence
 * spine (feat/permit-exhibit-spine, lib/permit-exhibit.ts).
 *
 * PHASE A (current): the sibling spine branch has not landed yet. This
 * module validates the PIN/radius exactly as the frozen contract requires
 * and returns a fixture-backed PermitExhibitResult so the full surface —
 * page, sections, gate, print route — is real and demoable end to end, not
 * placeholder markup. Every page/route in this feature imports ONLY this
 * module for data, never lib/permit-exhibit-fixtures.ts directly (tests are
 * the one exception, importing fixtures to build expected/mocked shapes).
 *
 * PHASE B (once feat/permit-exhibit-spine lands and lib/permit-exhibit.ts
 * exports the contract types): replace the fixture call in
 * `loadPermitExhibit` below with `buildPermitExhibit({ pin, radiusFt })`
 * from "@/lib/permit-exhibit", mapping its result onto
 * PermitExhibitResult if any field names differ from this file's working
 * assumptions (see lib/permit-exhibit-types.ts's header comment for the
 * one documented judgment call — `boundaryContext.parcelAddress`). No
 * other file in app/permit-exhibit or app/print/permit-exhibit should need
 * to change.
 */

import { normalizePin14 } from "./cook-viewer";
import { fixturePermitExhibit } from "./permit-exhibit-fixtures";
import {
  isPermitExhibitRadiusFt,
  type PermitExhibitLoadResult,
  type PermitExhibitRadiusFt,
} from "./permit-exhibit-types";

export interface LoadPermitExhibitInput {
  pin: string;
  radiusFt: number;
}

/**
 * Deterministic per-PIN variation so the Phase A demo surface behaves
 * differently for different inputs (an empty-subject PIN, a proximity-only
 * PIN) rather than always rendering the identical canned exhibit.
 */
function fixtureForPin(pin: string, radiusFt: PermitExhibitRadiusFt) {
  if (pin === "00000000000000") {
    return { ok: false as const, error: { kind: "parcel_not_found" as const } };
  }
  return {
    ok: true as const,
    data: fixturePermitExhibit({
      pin,
      radiusFt,
      exhibitId: `pex_${pin.slice(-10)}_${radiusFt}`,
    }),
  };
}

export async function loadPermitExhibit(
  input: LoadPermitExhibitInput,
): Promise<PermitExhibitLoadResult> {
  const pin = normalizePin14(input.pin);
  if (!pin) return { ok: false, error: { kind: "invalid_pin" } };
  if (!isPermitExhibitRadiusFt(input.radiusFt)) {
    return { ok: false, error: { kind: "invalid_radius" } };
  }

  return fixtureForPin(pin, input.radiusFt);
}
