import { describe, expect, it } from "vitest";
import {
  sanitizeAnalyticsEventPayload,
  isAnalyticsEventType,
} from "../analytics-events";

describe("analytics events", () => {
  it("accepts known product events", () => {
    expect(isAnalyticsEventType("site_page_viewed")).toBe(true);
    expect(isAnalyticsEventType("start_page_viewed")).toBe(true);
    expect(isAnalyticsEventType("location_snapshot_generated")).toBe(true);
    expect(isAnalyticsEventType("support_resource_clicked")).toBe(true);
    expect(isAnalyticsEventType("capital_partner_shown")).toBe(true);
    expect(isAnalyticsEventType("capital_partner_clicked")).toBe(true);
    expect(isAnalyticsEventType("capital_partner_contact_started")).toBe(true);
    expect(isAnalyticsEventType("program_link_clicked")).toBe(true);
    expect(isAnalyticsEventType("share_link_copied")).toBe(true);
    expect(isAnalyticsEventType("not_real")).toBe(false);
  });

  it("accepts the vacancy web report view event", () => {
    expect(isAnalyticsEventType("vacancy_web_report_viewed")).toBe(true);
    expect(isAnalyticsEventType("vacancy_index_pdf_downloaded")).toBe(true);
    expect(isAnalyticsEventType("vacancy_map_view_toggled")).toBe(true);
  });

  it("accepts the report-funnel instrumentation events added for the 2026-07 audit", () => {
    // Tier 0 "measure first" events: wizard step / refine exposure & click,
    // silent-engine-failure visibility, and save/email click-level telemetry.
    expect(isAnalyticsEventType("wizard_step_viewed")).toBe(true);
    expect(isAnalyticsEventType("refine_cta_shown")).toBe(true);
    expect(isAnalyticsEventType("refine_clicked")).toBe(true);
    expect(isAnalyticsEventType("report_generation_failed")).toBe(true);
    expect(isAnalyticsEventType("save_report_clicked")).toBe(true);
    expect(isAnalyticsEventType("email_report_clicked")).toBe(true);
    expect(isAnalyticsEventType("report_email_gate_skipped")).toBe(true);
    expect(isAnalyticsEventType("preparation_packet_started")).toBe(true);
    expect(isAnalyticsEventType("preparation_packet_created")).toBe(true);
    expect(isAnalyticsEventType("preparation_task_updated")).toBe(true);
    expect(isAnalyticsEventType("preparation_support_requested")).toBe(true);
  });

  it("sanitizes event payloads before storing", () => {
    const event = sanitizeAnalyticsEventPayload("refined_report_generated", {
      reportType: "site-incentives",
      source: "wizard",
      address: "  1207 W 63rd St  ",
      lat: 41.779444,
      lon: -87.654897,
      metadata: {
        zoneCount: 7,
        labels: ["ssa", "tif"],
        nested: { skip: true },
      } as never,
    });

    expect(event).toMatchObject({
      eventType: "refined_report_generated",
      reportType: "site-incentives",
      source: "wizard",
      address: "1207 W 63rd St",
      lat: 41.779444,
      lon: -87.654897,
      metadata: {
        zoneCount: 7,
        labels: ["ssa", "tif"],
      },
    });
    expect(event?.metadata).not.toHaveProperty("nested");
  });

  it("keeps mission metric metadata for support resource events", () => {
    const event = sanitizeAnalyticsEventPayload("support_resource_clicked", {
      reportType: "site-incentives",
      source: "report_support_network",
      address: "3039 E 91st St, Chicago, IL 60617",
      metadata: {
        reportKey: "site-incentives|2026-06-16|3039 E 91st St",
        reportTitle: "Location Snapshot",
        communityArea: "South Chicago",
        zipCode: "60617",
        organizationName: "Claretian Associates",
        organizationType: "EDO",
        contactMethod: "website",
      },
    });

    expect(event).toMatchObject({
      eventType: "support_resource_clicked",
      metadata: {
        organizationName: "Claretian Associates",
        contactMethod: "website",
        zipCode: "60617",
      },
    });
  });

  it("keeps privacy-safe traffic metadata", () => {
    const event = sanitizeAnalyticsEventPayload("site_page_viewed", {
      source: "site_traffic",
      metadata: {
        path: "/report",
        page: "Report Flow",
        sessionId: "session-123",
        deviceType: "mobile",
        viewportWidth: 390,
        nested: { skip: true },
      } as never,
    });

    expect(event).toMatchObject({
      eventType: "site_page_viewed",
      source: "site_traffic",
      metadata: {
        path: "/report",
        page: "Report Flow",
        sessionId: "session-123",
        deviceType: "mobile",
        viewportWidth: 390,
      },
    });
    expect(event?.metadata).not.toHaveProperty("nested");
  });

  it("keeps privacy-safe start page campaign metadata", () => {
    const event = sanitizeAnalyticsEventPayload("start_page_viewed", {
      source: "start_page",
      metadata: {
        campaign: "one-chicago",
        nested: { skip: true },
      } as never,
    });

    expect(event).toMatchObject({
      eventType: "start_page_viewed",
      source: "start_page",
      metadata: {
        campaign: "one-chicago",
      },
    });
    expect(event?.metadata).not.toHaveProperty("nested");
  });

  it("rejects unknown events", () => {
    expect(sanitizeAnalyticsEventPayload("whatever", {})).toBeNull();
  });

  it("accepts the Owner Files ownership-workflow events (MVP)", () => {
    expect(isAnalyticsEventType("owner_file_viewed")).toBe(true);
    expect(isAnalyticsEventType("owner_file_verification_saved")).toBe(true);
    expect(isAnalyticsEventType("owner_file_pdf_downloaded")).toBe(true);
    expect(isAnalyticsEventType("outreach_letter_generated")).toBe(true);
    expect(isAnalyticsEventType("outreach_letter_downloaded")).toBe(true);
    expect(isAnalyticsEventType("outreach_outcome_logged")).toBe(true);

    const event = sanitizeAnalyticsEventPayload("owner_file_verification_saved", {
      source: "owner_file_verification_form",
      metadata: { clusterKey: "mail:foo", zip: "60617", status: "verified", resolvedTier: "A" },
    });
    expect(event).toMatchObject({
      eventType: "owner_file_verification_saved",
      source: "owner_file_verification_form",
      metadata: { clusterKey: "mail:foo", zip: "60617", status: "verified", resolvedTier: "A" },
    });
  });

  it("accepts the Vacancy Opportunity Index PDF download event", () => {
    expect(isAnalyticsEventType("vacancy_index_pdf_downloaded")).toBe(true);

    const event = sanitizeAnalyticsEventPayload("vacancy_index_pdf_downloaded", {
      source: "owner_files_zip",
      metadata: { zip: "60624", siteCount: 15, truncated: false },
    });
    expect(event).toMatchObject({
      eventType: "vacancy_index_pdf_downloaded",
      source: "owner_files_zip",
      metadata: { zip: "60624", siteCount: 15, truncated: false },
    });
  });
});
