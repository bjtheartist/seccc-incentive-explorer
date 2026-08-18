/**
 * Mobile map overlay layout contract.
 *
 * On phones the map stacks several absolutely-positioned overlays in the top
 * band: the floating address search (MapSearch, `top-16` + `h-12`, z-60) and,
 * when a pin is tapped, the location dossier card (MapDossierCard, mounted by
 * MapView). The search bar must never cover the dossier's header — it did once
 * (both were `top-16`), which hid the tapped location's title under the search
 * field on every phone.
 *
 * Every mobile top-band overlay declares its offset HERE, in the same rem
 * units Tailwind spacing tokens use, and components/map/__tests__/
 * map-mobile-layout.test.tsx asserts the arithmetic (top + height + gap) for
 * each of them against the search bar's real classes. Change a number here and
 * the test tells you whether the band still fits; change a class in MapSearch
 * without updating this file and the test fails.
 */

/** MapSearch mobile offset — must equal the `top-N` class on its root. */
export const MOBILE_SEARCH_TOP_REM = 4;
/** MapSearch mobile input height — must equal the `h-N` class on the input. */
export const MOBILE_SEARCH_HEIGHT_REM = 3;
/** Minimum visible gap between the search bar's bottom edge and any overlay below it. */
export const MOBILE_OVERLAY_GAP_REM = 1;

/** Tailwind spacing token for the dossier card's mobile top offset. */
export const MOBILE_DOSSIER_TOP_REM = MOBILE_SEARCH_TOP_REM + MOBILE_SEARCH_HEIGHT_REM + MOBILE_OVERLAY_GAP_REM; // 8

/**
 * Class string for the mobile dossier-card wrapper. `top-32` is 8rem — the
 * literal must stay in sync with MOBILE_DOSSIER_TOP_REM (Tailwind cannot read
 * a computed token, so the test cross-checks the two).
 */
export const MOBILE_DOSSIER_WRAPPER_CLASS = "absolute inset-x-3 top-32 z-30";

/** Desktop dossier-card wrapper: centered, unaffected by the search bar. */
export const DESKTOP_DOSSIER_WRAPPER_CLASS =
  "absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2";

/** Parse the numeric spacing token from a Tailwind class like `top-32` → 8 (rem). */
export function tailwindSpacingRem(classes: string, prefix: "top" | "h"): number | null {
  const token = classes.split(/\s+/).find((value) => new RegExp(`^${prefix}-\\d+$`).test(value));
  return token ? Number(token.split("-")[1]) / 4 : null;
}
