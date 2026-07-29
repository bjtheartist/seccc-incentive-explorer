/**
 * Pure state and source-family configuration for the admin-only public
 * investment overlays within Community Investment.
 *
 * These overlays are independent of the Dots/Arcs/Density base mode and the
 * Megaprojects overlay. This module intentionally contains no rendering logic
 * and never imports server-only code, so it is safe in the map client bundle.
 */

export const PUBLIC_INVESTMENT_OVERLAY_IDS = [
  "county_relief_awards",
  "state_recovery_awards",
  "federal_restaurant_relief",
  "state_capital_projects",
] as const;

export type PublicInvestmentOverlayId = (typeof PUBLIC_INVESTMENT_OVERLAY_IDS)[number];

export const PUBLIC_INVESTMENT_SOURCE_IDS = [
  "cook-source-2023",
  "illinois-b2b",
  "sba-rrf",
  "dceo-capital",
] as const;
export type PublicInvestmentSourceId = (typeof PUBLIC_INVESTMENT_SOURCE_IDS)[number];

export interface PublicInvestmentOverlayConfig {
  id: PublicInvestmentOverlayId;
  label: string;
  description: string;
  sourceId: PublicInvestmentSourceId;
  adminOnly: true;
  defaultVisible: boolean;
}

/**
 * Reader-facing copy describes prior public investment and appropriations.
 * It must not present either source family as a current opportunity or an
 * estimate of incentive dollars a project could receive.
 */
export const PUBLIC_INVESTMENT_OVERLAYS = [
  {
    id: "county_relief_awards",
    label: "County relief awards",
    description:
      "Historical Cook County relief awards. This is past public investment, not an active funding opportunity.",
    sourceId: "cook-source-2023",
    adminOnly: true,
    defaultVisible: false,
  },
  {
    id: "state_recovery_awards",
    label: "Illinois recovery grants",
    description:
      "Historical Illinois Back to Business ARPA grants. ZIP-level source records; not an active opportunity.",
    sourceId: "illinois-b2b",
    adminOnly: true,
    defaultVisible: false,
  },
  {
    id: "federal_restaurant_relief",
    label: "Restaurant relief grants",
    description:
      "Historical SBA Restaurant Revitalization Fund grants. The federal program is closed and is not a current opportunity.",
    sourceId: "sba-rrf",
    adminOnly: true,
    defaultVisible: false,
  },
  {
    id: "state_capital_projects",
    label: "State capital projects",
    description:
      "Published state capital appropriations. An appropriation is not an active funding opportunity or expected incentive dollars.",
    sourceId: "dceo-capital",
    adminOnly: true,
    defaultVisible: false,
  },
] as const satisfies readonly PublicInvestmentOverlayConfig[];

export const PUBLIC_INVESTMENT_SOURCE_BY_OVERLAY_ID: Readonly<
  Record<PublicInvestmentOverlayId, PublicInvestmentSourceId>
> = {
  county_relief_awards: "cook-source-2023",
  state_recovery_awards: "illinois-b2b",
  federal_restaurant_relief: "sba-rrf",
  state_capital_projects: "dceo-capital",
};

const PUBLIC_INVESTMENT_OVERLAY_BY_SOURCE_ID: Readonly<
  Record<PublicInvestmentSourceId, PublicInvestmentOverlayId>
> = {
  "cook-source-2023": "county_relief_awards",
  "illinois-b2b": "state_recovery_awards",
  "sba-rrf": "federal_restaurant_relief",
  "dceo-capital": "state_capital_projects",
};

export type PublicInvestmentOverlayVisibility = Record<PublicInvestmentOverlayId, boolean>;

export const PUBLIC_INVESTMENT_OVERLAY_COLORS: Readonly<
  Record<PublicInvestmentOverlayId, string>
> = {
  county_relief_awards: "#0E7490",
  state_recovery_awards: "#B45309",
  federal_restaurant_relief: "#BE123C",
  state_capital_projects: "#0F766E",
};

export const DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY: Readonly<PublicInvestmentOverlayVisibility> =
  {
    county_relief_awards: false,
    state_recovery_awards: false,
    federal_restaurant_relief: false,
    state_capital_projects: false,
  };

export const PUBLIC_INVESTMENT_OVERLAYS_STORAGE_KEY =
  "cie_public_investment_overlay_visibility";

function defaultVisibility(): PublicInvestmentOverlayVisibility {
  return { ...DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY };
}

export function isPublicInvestmentOverlayId(value: unknown): value is PublicInvestmentOverlayId {
  return (
    typeof value === "string" &&
    (PUBLIC_INVESTMENT_OVERLAY_IDS as readonly string[]).includes(value)
  );
}

export function isPublicInvestmentSourceId(value: unknown): value is PublicInvestmentSourceId {
  return (
    typeof value === "string" &&
    (PUBLIC_INVESTMENT_SOURCE_IDS as readonly string[]).includes(value)
  );
}

/**
 * Parse persisted state defensively. A malformed payload resets to defaults;
 * a valid object with one malformed or missing field keeps any valid field and
 * defaults only the unusable value. Unknown fields are ignored.
 */
export function parsePublicInvestmentOverlayVisibility(
  raw: string | null | undefined,
): PublicInvestmentOverlayVisibility {
  if (!raw) return defaultVisibility();

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return defaultVisibility();
    }

    const values = parsed as Record<string, unknown>;
    return {
      county_relief_awards:
        typeof values.county_relief_awards === "boolean"
          ? values.county_relief_awards
          : DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY.county_relief_awards,
      state_recovery_awards:
        typeof values.state_recovery_awards === "boolean"
          ? values.state_recovery_awards
          : DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY.state_recovery_awards,
      federal_restaurant_relief:
        typeof values.federal_restaurant_relief === "boolean"
          ? values.federal_restaurant_relief
          : DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY.federal_restaurant_relief,
      state_capital_projects:
        typeof values.state_capital_projects === "boolean"
          ? values.state_capital_projects
          : DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY.state_capital_projects,
    };
  } catch {
    return defaultVisibility();
  }
}

/** Serialize in canonical overlay order for stable storage and snapshots. */
export function serializePublicInvestmentOverlayVisibility(
  visibility: PublicInvestmentOverlayVisibility,
): string {
  return JSON.stringify({
    county_relief_awards: visibility.county_relief_awards === true,
    state_recovery_awards: visibility.state_recovery_awards === true,
    federal_restaurant_relief: visibility.federal_restaurant_relief === true,
    state_capital_projects: visibility.state_capital_projects === true,
  });
}

/** Read the tab-scoped preference. Defaults on SSR or blocked storage. */
export function loadStoredPublicInvestmentOverlayVisibility(): PublicInvestmentOverlayVisibility {
  if (typeof window === "undefined") return defaultVisibility();
  try {
    return parsePublicInvestmentOverlayVisibility(
      window.sessionStorage.getItem(PUBLIC_INVESTMENT_OVERLAYS_STORAGE_KEY),
    );
  } catch {
    return defaultVisibility();
  }
}

/**
 * Persist the tab-scoped preference. The all-off default is represented by key
 * removal, matching the existing Community Investment and Megaproject toggles.
 */
export function storePublicInvestmentOverlayVisibility(
  visibility: PublicInvestmentOverlayVisibility,
): void {
  if (typeof window === "undefined") return;
  try {
    const isDefault = PUBLIC_INVESTMENT_OVERLAY_IDS.every(
      (id) => visibility[id] === DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY[id],
    );
    if (isDefault) {
      window.sessionStorage.removeItem(PUBLIC_INVESTMENT_OVERLAYS_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(
        PUBLIC_INVESTMENT_OVERLAYS_STORAGE_KEY,
        serializePublicInvestmentOverlayVisibility(visibility),
      );
    }
  } catch {
    // Persistence is best-effort; blocked storage must never break the map.
  }
}

/** Return a new visibility object with one overlay changed. */
export function withPublicInvestmentOverlayVisibility(
  visibility: PublicInvestmentOverlayVisibility,
  id: PublicInvestmentOverlayId,
  visible: boolean,
): PublicInvestmentOverlayVisibility {
  return { ...visibility, [id]: visible };
}

export function publicInvestmentOverlayIdForSource(
  source: string | null | undefined,
): PublicInvestmentOverlayId | null {
  return isPublicInvestmentSourceId(source)
    ? PUBLIC_INVESTMENT_OVERLAY_BY_SOURCE_ID[source]
    : null;
}

/** Canonical source IDs enabled by the current independent overlay state. */
export function visiblePublicInvestmentSourceIds(
  visibility: PublicInvestmentOverlayVisibility,
): PublicInvestmentSourceId[] {
  return PUBLIC_INVESTMENT_OVERLAY_IDS.filter((id) => visibility[id]).map(
    (id) => PUBLIC_INVESTMENT_SOURCE_BY_OVERLAY_ID[id],
  );
}

/**
 * Apply only the public-investment subfilters. Existing Community
 * Investment sources pass through untouched, while each new source family is
 * included only when its independent overlay is visible.
 */
export function filterRecordsByPublicInvestmentOverlays<T extends { source: string }>(
  records: readonly T[],
  visibility: PublicInvestmentOverlayVisibility,
): T[] {
  return records.filter((record) => {
    const overlayId = publicInvestmentOverlayIdForSource(record.source);
    return overlayId === null || visibility[overlayId] === true;
  });
}
