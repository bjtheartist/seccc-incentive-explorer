/**
 * Domain types for the User intelligence domain (Domain 6).
 * Captures product/user signals; no external data source.
 */

export interface SearchLogInput {
  userId?: string | null;
  query?: string | null;
  address?: string | null;
  lat?: number | null;
  lon?: number | null;
  resultCount?: number | null;
}

export interface WatchedArea {
  id: string;
  areaType: string;
  areaId: string;
  areaLabel: string | null;
  createdAt: string;
}

export interface WatchAreaInput {
  areaType: string;
  areaId: string;
  areaLabel?: string | null;
}

export interface ExportEventInput {
  userId?: string | null;
  reportId?: string | null;
  reportType?: string | null;
  format?: string | null;
}

export type CorrectionStatus = "pending" | "accepted" | "rejected";

export interface CorrectionInput {
  submitterUserId?: string | null;
  submitterEmail?: string | null;
  targetType: string;
  targetId: string;
  field?: string | null;
  currentValue?: string | null;
  suggestedValue?: string | null;
  note?: string | null;
}

export interface PartnerCorrection {
  id: string;
  status: CorrectionStatus;
  createdAt: string;
}
