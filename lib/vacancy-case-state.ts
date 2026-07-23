import type { OwnerType } from "./owner-classify";
import type { OwnerGeography, OwnerStructure } from "./owner-taxonomy";

/**
 * Client-safe Case Workbench contract. Keep this module free of filesystem,
 * database, and server-only imports so the interactive workbench can share its
 * types and URL codec without pulling the vacancy export loader into the
 * browser bundle.
 */
export interface VacancyCaseRecord {
  id: string;
  address: string;
  pin: string | null;
  universe: "land" | "building_report";
  ownerType: OwnerType;
  ownerStructure: OwnerStructure | null;
  ownerGeography: OwnerGeography | null;
  saleYear: number | null;
  violation: boolean;
  squareFeet: number | null;
  lat: number | null;
  lon: number | null;
}

export interface VacancyCaseArea {
  id: number;
  name: string;
  siteCount: number;
  mappedCount: number;
  corridor: string | null;
  scenario: string;
  needsChecking: string;
}

export type WorkbenchMode = "paths" | "builder" | "compare";
export type PresetId =
  | "public-land"
  | "private-outreach"
  | "ownership-check"
  | "building-review"
  | "tax-title";
export type BuilderGoal = "all" | "public" | "private" | "verify" | "conditions";
export type BuilderUniverse = "all" | "land" | "building_report";

export interface VacancyWorkbenchInitialState {
  mode: WorkbenchMode;
  activePreset: PresetId;
  goal: BuilderGoal;
  universe: BuilderUniverse;
  taxSaleOnly: boolean;
  violationsOnly: boolean;
  initialSelectedIds: string[];
}

export interface CaseUrlState {
  mode: WorkbenchMode;
  activePreset: PresetId;
  goal: BuilderGoal;
  universe: BuilderUniverse;
  taxSaleOnly: boolean;
  violationsOnly: boolean;
  selectedIds: string[];
}

const MAX_SELECTED = 3;

/** Serialize the current workbench state into its shareable URL contract. */
export function buildCaseSearchParams(state: CaseUrlState): URLSearchParams {
  const params = new URLSearchParams();
  params.set("view", state.mode);
  if (state.mode === "paths") params.set("case", state.activePreset);
  if (state.mode === "builder") {
    params.set("goal", state.goal);
    params.set("records", state.universe);
    if (state.taxSaleOnly) params.set("tax", "1");
    if (state.violationsOnly) params.set("violations", "1");
  }
  if (state.selectedIds.length > 0) {
    params.set("sel", state.selectedIds.slice(0, MAX_SELECTED).join(","));
  }
  return params;
}
