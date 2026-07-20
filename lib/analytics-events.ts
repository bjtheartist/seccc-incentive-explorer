export const ANALYTICS_EVENT_TYPES = [
  "site_page_viewed",
  "start_page_viewed",
  "search_performed",
  "location_snapshot_requested",
  "map_mobile_preset_selected",
  "location_snapshot_generated",
  "refined_report_generated",
  "vacancy_report_generated",
  "corridor_report_generated",
  "refine_value_preview_shown",
  "inline_refine_used",
  "report_saved",
  "report_emailed",
  "report_email_gate_skipped",
  "report_pdf_downloaded",
  "spreadsheet_exported",
  "inquiry_submitted",
  "support_resource_viewed",
  "support_resource_clicked",
  "capital_partner_shown",
  "capital_partner_clicked",
  "capital_partner_contact_started",
  "program_link_clicked",
  "share_link_copied",
  "demo_address_clicked",
  "map_preview_clicked",
  "persona_chip_selected",
  "wizard_step_viewed",
  "refine_cta_shown",
  "refine_clicked",
  "report_generation_failed",
  "save_report_clicked",
  "email_report_clicked",
  "preparation_packet_started",
  "preparation_packet_created",
  "preparation_task_updated",
  "preparation_support_requested",
  "preparation_program_selected",
  "business_file_home_viewed",
  "foundation_refresh_confirmed",
  "packet_document_uploaded",
  "packet_document_deleted",
  "packet_document_extract_suggested",
  "concierge_opened",
  "concierge_message_sent",
  "concierge_tool_called",
  "concierge_nav_suggested",
  "concierge_action_proposed",
  "concierge_action_approved",
  "concierge_action_declined",
  // ── Owner Files ("Who Owns It?" ownership workflow, MVP) ──────────
  "owner_file_viewed",
  "owner_file_verification_saved",
  "owner_file_pdf_downloaded",
  "outreach_letter_generated",
  "outreach_letter_downloaded",
  "outreach_outcome_logged",
  "vacancy_index_pdf_downloaded",
  "vacancy_web_report_viewed",
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
