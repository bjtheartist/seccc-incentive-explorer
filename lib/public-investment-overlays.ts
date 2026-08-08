/**
 * Pure state and source-family configuration for the admin-only public
 * investment overlays within Community Investment.
 *
 * These overlays are independent of the Dots/Arcs/Density base mode and the
 * Megaprojects overlay. This module intentionally contains no rendering logic
 * and never imports server-only code, so it is safe in the map client bundle.
 */

import type { GovernmentFundingPurpose } from "@/lib/government-funding-purpose";

export const PUBLIC_INVESTMENT_OVERLAY_IDS = [
  "county_relief_awards",
  "state_2020_relief",
  "state_recovery_awards",
  "federal_restaurant_relief",
  "state_capital_projects",
] as const;

export type PublicInvestmentOverlayId = (typeof PUBLIC_INVESTMENT_OVERLAY_IDS)[number];

export const PUBLIC_INVESTMENT_SOURCE_IDS = [
  "cook-source-2023",
  "illinois-big",
  "illinois-hospitality-emergency",
  "illinois-b2b",
  "sba-rrf",
  "dceo-capital",
] as const;
export type PublicInvestmentSourceId = (typeof PUBLIC_INVESTMENT_SOURCE_IDS)[number];

export interface PublicInvestmentOverlayConfig {
  id: PublicInvestmentOverlayId;
  label: string;
  description: string;
  sourceIds: readonly PublicInvestmentSourceId[];
  fundingPurpose: Extract<
    GovernmentFundingPurpose,
    "capital_project" | "programmatic"
  >;
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
    sourceIds: ["cook-source-2023"],
    fundingPurpose: "programmatic",
    adminOnly: true,
    defaultVisible: false,
  },
  {
    id: "state_2020_relief",
    label: "Illinois 2020 relief",
    description:
      "Historical Illinois BIG and Hospitality Emergency grants. BIG is mapped only by ZIP; Hospitality records remain unplotted because the source publishes only a municipality.",
    sourceIds: ["illinois-big", "illinois-hospitality-emergency"],
    fundingPurpose: "programmatic",
    adminOnly: true,
    defaultVisible: false,
  },
  {
    id: "state_recovery_awards",
    label: "Illinois recovery grants",
    description:
      "Historical Illinois Back to Business ARPA grants. ZIP-level source records; not an active opportunity.",
    sourceIds: ["illinois-b2b"],
    fundingPurpose: "programmatic",
    adminOnly: true,
    defaultVisible: false,
  },
  {
    id: "federal_restaurant_relief",
    label: "Restaurant relief grants",
    description:
      "Historical SBA Restaurant Revitalization Fund grants. The federal program is closed and is not a current opportunity.",
    sourceIds: ["sba-rrf"],
    fundingPurpose: "programmatic",
    adminOnly: true,
    defaultVisible: false,
  },
  {
    id: "state_capital_projects",
    label: "State capital projects",
    description:
      "Published state capital appropriations. An appropriation is not an active funding opportunity or expected incentive dollars.",
    sourceIds: ["dceo-capital"],
    fundingPurpose: "capital_project",
    adminOnly: true,
    defaultVisible: false,
  },
] as const satisfies readonly PublicInvestmentOverlayConfig[];

export const PUBLIC_INVESTMENT_SOURCES_BY_OVERLAY_ID: Readonly<
  Record<PublicInvestmentOverlayId, readonly PublicInvestmentSourceId[]>
> = {
  county_relief_awards: ["cook-source-2023"],
  state_2020_relief: ["illinois-big", "illinois-hospitality-emergency"],
  state_recovery_awards: ["illinois-b2b"],
  federal_restaurant_relief: ["sba-rrf"],
  state_capital_projects: ["dceo-capital"],
};

const PUBLIC_INVESTMENT_OVERLAY_BY_SOURCE_ID: Readonly<
  Record<PublicInvestmentSourceId, PublicInvestmentOverlayId>
> = {
  "cook-source-2023": "county_relief_awards",
  "illinois-big": "state_2020_relief",
  "illinois-hospitality-emergency": "state_2020_relief",
  "illinois-b2b": "state_recovery_awards",
  "sba-rrf": "federal_restaurant_relief",
  "dceo-capital": "state_capital_projects",
};

export type PublicInvestmentOverlayVisibility = Record<PublicInvestmentOverlayId, boolean>;

export const PUBLIC_INVESTMENT_OVERLAY_COLORS: Readonly<
  Record<PublicInvestmentOverlayId, string>
> = {
  county_relief_awards: "#0E7490",
  state_2020_relief: "#7C3AED",
  state_recovery_awards: "#B45309",
  federal_restaurant_relief: "#BE123C",
  state_capital_projects: "#0F766E",
};

export const DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY: Readonly<PublicInvestmentOverlayVisibility> =
  {
    county_relief_awards: false,
    state_2020_relief: false,
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
      state_2020_relief:
        typeof values.state_2020_relief === "boolean"
          ? values.state_2020_relief
          : DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY.state_2020_relief,
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
    state_2020_relief: visibility.state_2020_relief === true,
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

/**
 * Whether an OPEN recipient-drilldown panel is still authorized to render.
 *
 * The drilldown panel is the most identifying surface in the layer — it lists
 * recipient BUSINESS NAMES against award amounts, which is exactly what the
 * ZIP-aggregate map design and the gated per-ZIP endpoint exist to keep off the
 * screen. So it must hard-close on EVERY teardown path, not only its own X
 * button: its own overlay toggling off, the Community Investment master toggle
 * going off, or the admin session dropping.
 *
 * Pure and exhaustive over the teardown inputs, so the rule is unit-testable
 * away from mapbox.
 */
export function shouldKeepRecipientsPanelOpen(input: {
  adminSessionActive: boolean;
  communityInvestmentVisible: boolean;
  overlays: PublicInvestmentOverlayVisibility;
  /** The source whose recipients the open panel is showing. */
  sourceId: string;
}): boolean {
  if (!input.adminSessionActive) return false;
  if (!input.communityInvestmentVisible) return false;
  const overlayId = publicInvestmentOverlayIdForSource(input.sourceId);
  // An unknown source has no overlay that could switch it off — fail closed
  // rather than leaving names on screen with no control bound to them.
  if (overlayId === null) return false;
  return input.overlays[overlayId] === true;
}

/** Canonical source IDs enabled by the current independent overlay state. */
export function visiblePublicInvestmentSourceIds(
  visibility: PublicInvestmentOverlayVisibility,
): PublicInvestmentSourceId[] {
  return PUBLIC_INVESTMENT_OVERLAY_IDS.filter((id) => visibility[id]).flatMap(
    (id) => PUBLIC_INVESTMENT_SOURCES_BY_OVERLAY_ID[id],
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
