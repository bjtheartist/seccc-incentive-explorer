import type { ParcelSpaceFacts } from "@/lib/parcel-space";

export type MapDossierFreshness = {
  status: "current" | "stale";
  asOf?: string | null;
  note?: string | null;
};

export interface MapDossierAction {
  label: string;
  href: string;
  external?: boolean;
}

export interface MapDossierNextStep {
  text: string;
  primaryAction?: MapDossierAction | null;
  secondaryAction?: MapDossierAction | null;
}

export interface MapDossierSource {
  label: string;
  href?: string | null;
  asOf?: string | null;
  note?: string | null;
}

interface MapDossierSelectionBase {
  title: string;
  subtitle?: string | null;
  summary?: string | null;
  freshness?: MapDossierFreshness | null;
  nextStep?: MapDossierNextStep | null;
  sources?: readonly MapDossierSource[];
}

export interface MapDossierAddressSelection extends MapDossierSelectionBase {
  kind: "address";
  lat?: number | null;
  lon?: number | null;
}

export interface MapDossierParcelSelection extends MapDossierSelectionBase {
  kind: "parcel";
  pin: string | null;
  propertyClass?: string | null;
  propertyClassDescription?: string | null;
  propertyType?: string | null;
  assessedTotal?: number | null;
  space?: ParcelSpaceFacts;
}

export interface MapDossierVacancySelection extends MapDossierSelectionBase {
  kind: "vacancy";
  vacancyType: "vacant_land" | "vacant_building";
  pin?: string | null;
  squareFeet?: number | null;
  space?: ParcelSpaceFacts;
  incentiveGeographyCount?: number | null;
  reasonFlagged?: string | null;
}

export interface MapDossierPermitSelection extends MapDossierSelectionBase {
  kind: "permit";
  permitId: string;
  permitType?: string | null;
  permitStatus?: string | null;
  issueDate?: string | null;
  workDescription?: string | null;
  reportedCost?: number | null;
  pin?: string | null;
}

export interface MapDossierPoiSelection extends MapDossierSelectionBase {
  kind: "poi";
  category: string;
  address?: string | null;
  agency?: string | null;
}

/**
 * A map selection normalized for the shared property dossier. The union carries
 * source fields only; matching, eligibility, and ranking scores stay internal.
 */
export type MapDossierSelection =
  | MapDossierAddressSelection
  | MapDossierParcelSelection
  | MapDossierVacancySelection
  | MapDossierPermitSelection
  | MapDossierPoiSelection;
