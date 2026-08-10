import {
  normalizePractitionerValidationCampaign,
  resolvePractitionerValidationCampaign,
} from "./practitioner-validation";

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
  "vacancy_map_view_toggled",
  "vacancy_directory_opened",
  "first_visit_guide_viewed",
  "first_visit_guide_started",
  "first_visit_guide_step_viewed",
  "first_visit_guide_skipped",
  "first_visit_guide_completed",
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

const PRACTITIONER_VALIDATION_SESSION_KEY = "cie_practitioner_validation_campaign";

/**
 * Query flag the admin dashboard appends to its own facilitated-case links, so an
 * operator checking that a link works is not published as a participant visit.
 */
export const PRACTITIONER_VALIDATION_PREVIEW_PARAM = "pilot_preview";
const PRACTITIONER_VALIDATION_PREVIEW_SESSION_KEY = "cie_practitioner_validation_preview";
/**
 * Recorded in place of a pilot campaign during an operator preview. The pilot
 * aggregation keys on the five exact case campaigns, so this value is ignored
 * there, while the visit is still recorded as what it actually was (the case id
 * survives in utm_source).
 */
const PRACTITIONER_VALIDATION_PREVIEW_CAMPAIGN = "admin-pilot-preview";

function readSessionValue(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    // Session attribution is optional and must never interrupt product usage.
    return null;
  }
}

function writeSessionValue(key: string, value: string | null) {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function firstExplicitCampaign(...values: unknown[]): unknown | null {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    return value;
  }
  return null;
}

function campaignFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  return firstExplicitCampaign(
    params.get("campaign"),
    params.get("utm_campaign"),
    params.get("c"),
  ) as string | null;
}

/**
 * Latches the preview flag for the rest of the tab: the flag only rides the
 * first URL, but the operator's later searches and reports would otherwise be
 * pulled into the case funnel by the stored campaign. Also drops any campaign a
 * previous visit stored in this tab.
 *
 * Arriving on an UNFLAGGED case link releases the latch. The same tab is used to
 * preview a link and then to run a real facilitated session; without this exit
 * the real session was rewritten to the preview campaign and dropped from the
 * pilot counts, with no way to clear it short of closing the tab.
 */
function isPractitionerValidationPreviewSession(search: string): boolean {
  const params = new URLSearchParams(search);
  if (params.has(PRACTITIONER_VALIDATION_PREVIEW_PARAM)) {
    writeSessionValue(PRACTITIONER_VALIDATION_PREVIEW_SESSION_KEY, "1");
    writeSessionValue(PRACTITIONER_VALIDATION_SESSION_KEY, null);
    return true;
  }
  // Only the case-link entry form releases it -- utm_campaign, what
  // practitionerValidationStartPath builds. Accepting any recognized campaign
  // param released the latch during the operator's own preview: /start -> /report
  // forwards the campaign as `campaign=` and does not carry pilot_preview, so
  // searching an address (the only way to check the link works) put the preview
  // back into that case's counts.
  if (normalizePractitionerValidationCampaign(params.get("utm_campaign"))) {
    writeSessionValue(PRACTITIONER_VALIDATION_PREVIEW_SESSION_KEY, null);
    return false;
  }
  return readSessionValue(PRACTITIONER_VALIDATION_PREVIEW_SESSION_KEY) === "1";
}

function withPractitionerValidationCampaign(
  metadata: AnalyticsMetadata | null | undefined,
): AnalyticsMetadata {
  const current = metadata ?? {};
  const search = window.location.search;
  // SiteTrafficTracker preserves standard UTM naming (`utmCampaign`), while
  // report/start events use `campaign`. The raw URL check also protects events
  // that do not carry traffic metadata of their own. Any explicit campaign must
  // outrank a pilot campaign left in this tab by an earlier visit.
  const explicit = firstExplicitCampaign(
    current.campaign,
    current.utmCampaign,
    campaignFromSearch(search),
  );

  if (isPractitionerValidationPreviewSession(search)) {
    return normalizePractitionerValidationCampaign(explicit)
      ? { ...current, campaign: PRACTITIONER_VALIDATION_PREVIEW_CAMPAIGN }
      : current;
  }

  // A caller-supplied campaign that is not one of the five pilot campaigns is
  // still real attribution (a QR/UTM code, or /start's "direct" fallback), so it
  // has to survive. Letting the stored campaign win here overwrote the QR value
  // the /start -> /report chain exists to carry, and counted a visit that used no
  // facilitated case link as a pilot start.
  const explicitProvided = explicit !== null;
  if (explicitProvided && !normalizePractitionerValidationCampaign(explicit)) {
    writeSessionValue(PRACTITIONER_VALIDATION_SESSION_KEY, null);
    return current;
  }

  const campaign = resolvePractitionerValidationCampaign({
    explicit,
    search,
    stored: readSessionValue(PRACTITIONER_VALIDATION_SESSION_KEY),
  });

  if (!campaign) return current;

  writeSessionValue(PRACTITIONER_VALIDATION_SESSION_KEY, campaign);

  return { ...current, campaign };
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

  const event = sanitizeAnalyticsEventPayload(eventType, {
    ...payload,
    metadata: withPractitionerValidationCampaign(payload.metadata),
  });
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
