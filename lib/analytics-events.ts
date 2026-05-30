export const ANALYTICS_EVENT_TYPES = [
  "search_performed",
  "location_snapshot_requested",
  "location_snapshot_generated",
  "refined_report_generated",
  "vacancy_report_generated",
  "report_saved",
  "report_emailed",
  "report_pdf_downloaded",
  "spreadsheet_exported",
  "inquiry_submitted",
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export type AnalyticsMetadata = Record<
  string,
  string | number | boolean | null | (string | number | boolean)[]
>;

export interface AnalyticsEventPayload {
  eventType?: string;
  reportType?: string | null;
  source?: string | null;
  address?: string | null;
  lat?: number | null;
  lon?: number | null;
  metadata?: AnalyticsMetadata | null;
}

export interface SanitizedAnalyticsEvent {
  eventType: AnalyticsEventType;
  reportType: string | null;
  source: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  metadata: AnalyticsMetadata;
}

export function isAnalyticsEventType(value: unknown): value is AnalyticsEventType {
  return (
    typeof value === "string" &&
    ANALYTICS_EVENT_TYPES.includes(value as AnalyticsEventType)
  );
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function cleanCoordinate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function cleanMetadataValue(value: unknown) {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    const cleaned = value
      .filter(
        (item) =>
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean"
      )
      .slice(0, 25);
    return cleaned.length > 0 ? cleaned : undefined;
  }

  return undefined;
}

function cleanMetadata(value: unknown): AnalyticsMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const entries = Object.entries(value as Record<string, unknown>).slice(0, 25);
  return entries.reduce<AnalyticsMetadata>((acc, [key, item]) => {
    const cleanKey = cleanText(key, 64);
    if (!cleanKey) return acc;

    const cleanValue = cleanMetadataValue(item);
    if (cleanValue === undefined) return acc;
    acc[cleanKey] = cleanValue;
    return acc;
  }, {});
}

export function sanitizeAnalyticsEventPayload(
  eventType: unknown,
  payload: AnalyticsEventPayload = {}
): SanitizedAnalyticsEvent | null {
  if (!isAnalyticsEventType(eventType)) return null;

  return {
    eventType,
    reportType: cleanText(payload.reportType, 80),
    source: cleanText(payload.source, 80),
    address: cleanText(payload.address, 500),
    lat: cleanCoordinate(payload.lat),
    lon: cleanCoordinate(payload.lon),
    metadata: cleanMetadata(payload.metadata),
  };
}

export function trackEvent(
  eventType: AnalyticsEventType,
  payload: Omit<AnalyticsEventPayload, "eventType"> = {}
) {
  if (typeof window === "undefined") return;

  const event = sanitizeAnalyticsEventPayload(eventType, payload);
  if (!event) return;

  const body = JSON.stringify(event);
  void fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: body.length < 60000,
  }).catch(() => {
    // Analytics should never interrupt report generation.
  });
}
