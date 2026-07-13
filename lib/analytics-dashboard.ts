import type { NeonQueryFunction } from "@neondatabase/serverless";

type SqlClient = NeonQueryFunction<false, false>;

export const REPORT_GENERATED_EVENTS = [
  "location_snapshot_generated",
  "refined_report_generated",
  "vacancy_report_generated",
  "corridor_report_generated",
] as const;

export const REPORT_ACTIVATION_EVENTS = [
  "report_emailed",
  "report_pdf_downloaded",
  "report_saved",
  "spreadsheet_exported",
  "inquiry_submitted",
  "support_resource_clicked",
  "capital_partner_clicked",
  "capital_partner_contact_started",
] as const;

const RESOURCE_CONNECTION_EVENTS = [
  "support_resource_clicked",
  "capital_partner_clicked",
  "capital_partner_contact_started",
] as const;

type EventMetadata = Record<string, unknown>;

export interface AnalyticsEventRow {
  event_type: string;
  report_type: string | null;
  source: string | null;
  address: string | null;
  lat?: number | null;
  lon?: number | null;
  metadata_json: EventMetadata | string | null;
  created_at: string | Date;
}

export interface FollowUpLead {
  name: string;
  email: string;
  zipCode: string;
  reportAddress: string | null;
  reportTitle: string | null;
  projectGoal: string | null;
  wantsIncentiveHelp: boolean;
  deliverySource: string | null;
  emailDeliveredAt: string | null;
  createdAt: string;
}

export interface AnalyticsDashboardSummary {
  windowDays: number;
  since: string;
  totals: {
    pageViews: number;
    uniqueVisitorSessions: number;
    searches: number;
    snapshotRequests: number;
    reportsGenerated: number;
    activatedReports: number;
    activationActions: number;
    activationRate: number;
    localResourceConnections: number;
    connectionOpportunitiesSurfaced: number;
    resourceConnectionRate: number;
    capitalPartnerReferralsShown: number;
    capitalPartnerClicks: number;
    capitalPartnerContactsStarted: number;
    vacancySpreadsheetExports: number;
    neighborhoodsReached: number;
  };
  eventsByType: { event_type: string; count: number }[];
  eventsByDay: { day: string; event_type: string; count: number }[];
  dailyTraffic: { day: string; pageViews: number; uniqueVisitorSessions: number }[];
  weeklyTraffic: { weekStart: string; pageViews: number; uniqueVisitorSessions: number }[];
  reportsByType: { label: string; count: number }[];
  topPages: { label: string; count: number }[];
  deviceBreakdown: { label: string; count: number; percent: number }[];
  topNeighborhoods: { label: string; count: number }[];
  topPrograms: { label: string; count: number }[];
  topSupportOrganizations: { label: string; count: number }[];
  topCapitalPartners: { label: string; count: number }[];
  recentActivity: {
    createdAt: string;
    eventType: string;
    reportType: string | null;
    address: string | null;
    source: string | null;
    summary: string;
  }[];
  followUpQueue: FollowUpLead[];
  lifetime: {
    users: number | null;
    savedReports: number | null;
    businessProjects: number | null;
    reportLeads: number | null;
  };
  partnerSummary: {
    headline: string;
    bullets: string[];
  };
}

const GENERATED_SET = new Set<string>(REPORT_GENERATED_EVENTS);
const ACTIVATION_SET = new Set<string>(REPORT_ACTIVATION_EVENTS);

function normalizeMetadata(value: AnalyticsEventRow["metadata_json"]): EventMetadata {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as EventMetadata)
        : {};
    } catch {
      return {};
    }
  }
  return value;
}

function metadataString(metadata: EventMetadata, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataNumber(metadata: EventMetadata, key: string): number {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return 0;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function dayKey(value: string | Date): string {
  return toIso(value).slice(0, 10);
}

function weekStartKey(value: string | Date): string {
  const date = new Date(toIso(value));
  const day = date.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

function hourBucket(value: string | Date): string {
  return toIso(value).slice(0, 13);
}

export function buildReportEventKey(row: AnalyticsEventRow): string {
  const metadata = normalizeMetadata(row.metadata_json);
  const explicitKey = metadataString(metadata, "reportKey");
  if (explicitKey) return explicitKey;

  return [
    row.address?.trim().toLowerCase() || "unknown-address",
    row.report_type || "unknown-report",
    hourBucket(row.created_at),
  ].join("|");
}

function increment(map: Map<string, number>, key: string | null | undefined) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function ranked(map: Map<string, number>, limit = 8) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function rankedWithPercent(map: Map<string, number>, denominator: number, limit = 8) {
  return ranked(map, limit).map((row) => ({
    ...row,
    percent: denominator > 0 ? Math.round((row.count / denominator) * 100) : 0,
  }));
}

function eventSummary(row: AnalyticsEventRow): string {
  const metadata = normalizeMetadata(row.metadata_json);
  if (row.event_type === "site_page_viewed") {
    return metadataString(metadata, "page") || metadataString(metadata, "path") || "Page view";
  }
  if (row.event_type === "support_resource_clicked") {
    const org = metadataString(metadata, "organizationName") || "Support resource";
    const method = metadataString(metadata, "contactMethod") || "contact";
    return `${org} ${method}`;
  }
  if (
    row.event_type === "capital_partner_shown" ||
    row.event_type === "capital_partner_clicked" ||
    row.event_type === "capital_partner_contact_started"
  ) {
    const partner = metadataString(metadata, "partnerName") || "Financing resource";
    const method = metadataString(metadata, "contactMethod");
    return method ? `${partner} ${method}` : partner;
  }
  if (row.event_type === "program_link_clicked") {
    return metadataString(metadata, "programId") || metadataString(metadata, "programName") || "Program link";
  }
  if (row.event_type === "spreadsheet_exported") {
    return metadataString(metadata, "locale") || "Vacancy spreadsheet";
  }
  return metadataString(metadata, "reportTitle") || metadataString(metadata, "businessName") || row.source || row.event_type;
}

export function summarizeAnalyticsEvents(
  rows: AnalyticsEventRow[],
  options: {
    windowDays: number;
    since: string;
    lifetime?: AnalyticsDashboardSummary["lifetime"];
    followUpQueue?: FollowUpLead[];
  }
): AnalyticsDashboardSummary {
  const eventsByType = new Map<string, number>();
  const eventsByDay = new Map<string, number>();
  const reportsByType = new Map<string, number>();
  const topNeighborhoods = new Map<string, number>();
  const topPrograms = new Map<string, number>();
  const topSupportOrganizations = new Map<string, number>();
  const topCapitalPartners = new Map<string, number>();
  const topPages = new Map<string, number>();
  const deviceBreakdown = new Map<string, number>();
  const dailyPageViews = new Map<string, number>();
  const dailySessions = new Map<string, Set<string>>();
  const weeklyPageViews = new Map<string, number>();
  const weeklySessions = new Map<string, Set<string>>();
  const visitorSessions = new Set<string>();
  const generatedReportKeys = new Set<string>();
  const activatedReportKeys = new Set<string>();
  const reachedNeighborhoods = new Set<string>();

  let connectionOpportunitiesSurfaced = 0;

  for (const row of rows) {
    const metadata = normalizeMetadata(row.metadata_json);
    increment(eventsByType, row.event_type);
    increment(eventsByDay, `${dayKey(row.created_at)}|${row.event_type}`);

    if (row.event_type === "site_page_viewed") {
      const day = dayKey(row.created_at);
      const week = weekStartKey(row.created_at);
      const sessionId = metadataString(metadata, "sessionId");
      increment(dailyPageViews, day);
      increment(weeklyPageViews, week);
      increment(topPages, metadataString(metadata, "page") || metadataString(metadata, "path") || "Unknown page");
      increment(deviceBreakdown, metadataString(metadata, "deviceType") || "unknown");
      if (sessionId) {
        visitorSessions.add(sessionId);
        if (!dailySessions.has(day)) dailySessions.set(day, new Set());
        if (!weeklySessions.has(week)) weeklySessions.set(week, new Set());
        dailySessions.get(day)?.add(sessionId);
        weeklySessions.get(week)?.add(sessionId);
      }
    }

    const neighborhood =
      metadataString(metadata, "communityArea") ||
      metadataString(metadata, "neighborhood") ||
      metadataString(metadata, "zipCode");
    if (neighborhood) {
      increment(topNeighborhoods, neighborhood);
      reachedNeighborhoods.add(neighborhood);
    }

    if (GENERATED_SET.has(row.event_type)) {
      generatedReportKeys.add(buildReportEventKey(row));
      increment(reportsByType, row.report_type || "Unknown report");
    }

    if (ACTIVATION_SET.has(row.event_type)) {
      activatedReportKeys.add(buildReportEventKey(row));
    }

    if (row.event_type === "support_resource_viewed") {
      connectionOpportunitiesSurfaced += metadataNumber(metadata, "organizationCount");
    }

    if (row.event_type === "support_resource_clicked") {
      increment(topSupportOrganizations, metadataString(metadata, "organizationName") || "Unknown organization");
    }

    if (
      row.event_type === "capital_partner_clicked" ||
      row.event_type === "capital_partner_contact_started"
    ) {
      increment(
        topCapitalPartners,
        metadataString(metadata, "partnerName") || "Unknown financing resource",
      );
    }

    if (row.event_type === "program_link_clicked") {
      increment(topPrograms, metadataString(metadata, "programId") || metadataString(metadata, "programName") || "Unknown program");
    }
  }

  const eventCount = (eventType: string) => eventsByType.get(eventType) ?? 0;
  const pageViews = eventCount("site_page_viewed");
  const reportsGenerated = generatedReportKeys.size || REPORT_GENERATED_EVENTS.reduce((sum, type) => sum + eventCount(type), 0);
  const activatedReports = activatedReportKeys.size;
  const activationActions = REPORT_ACTIVATION_EVENTS.reduce((sum, type) => sum + eventCount(type), 0);
  const localResourceConnections = RESOURCE_CONNECTION_EVENTS.reduce((sum, type) => sum + eventCount(type), 0);
  const activationRate = reportsGenerated > 0 ? Math.round((activatedReports / reportsGenerated) * 100) : 0;
  const resourceConnectionRate = reportsGenerated > 0
    ? Math.min(100, Math.round((localResourceConnections / reportsGenerated) * 100))
    : 0;
  const capitalPartnerReferralsShown = eventCount("capital_partner_shown");
  const capitalPartnerClicks = eventCount("capital_partner_clicked");
  const capitalPartnerContactsStarted = eventCount("capital_partner_contact_started");

  const partnerBullets = [
    `${reportsGenerated.toLocaleString()} report${reportsGenerated === 1 ? "" : "s"} generated`,
    `${activatedReports.toLocaleString()} report${activatedReports === 1 ? "" : "s"} moved into an action step`,
    `${localResourceConnections.toLocaleString()} local resource contact action${localResourceConnections === 1 ? "" : "s"} tracked`,
    `${capitalPartnerReferralsShown.toLocaleString()} financing resource listing${capitalPartnerReferralsShown === 1 ? "" : "s"} shown`,
    `${(capitalPartnerClicks + capitalPartnerContactsStarted).toLocaleString()} financing resource contact action${capitalPartnerClicks + capitalPartnerContactsStarted === 1 ? "" : "s"} tracked`,
    `${connectionOpportunitiesSurfaced.toLocaleString()} support organization ${
      connectionOpportunitiesSurfaced === 1 ? "opportunity" : "opportunities"
    } surfaced`,
    `${reachedNeighborhoods.size.toLocaleString()} neighborhood or ZIP context${reachedNeighborhoods.size === 1 ? "" : "s"} reached`,
  ];

  return {
    windowDays: options.windowDays,
    since: options.since,
    totals: {
      pageViews,
      uniqueVisitorSessions: visitorSessions.size,
      searches: eventCount("search_performed"),
      snapshotRequests: eventCount("location_snapshot_requested"),
      reportsGenerated,
      activatedReports,
      activationActions,
      activationRate,
      localResourceConnections,
      connectionOpportunitiesSurfaced,
      resourceConnectionRate,
      capitalPartnerReferralsShown,
      capitalPartnerClicks,
      capitalPartnerContactsStarted,
      vacancySpreadsheetExports: eventCount("spreadsheet_exported"),
      neighborhoodsReached: reachedNeighborhoods.size,
    },
    eventsByType: ranked(eventsByType, 20).map(({ label, count }) => ({ event_type: label, count })),
    eventsByDay: [...eventsByDay.entries()]
      .map(([key, count]) => {
        const [day, event_type] = key.split("|");
        return { day, event_type, count };
      })
      .sort((a, b) => b.day.localeCompare(a.day) || a.event_type.localeCompare(b.event_type)),
    dailyTraffic: [...dailyPageViews.entries()]
      .map(([day, views]) => ({
        day,
        pageViews: views,
        uniqueVisitorSessions: dailySessions.get(day)?.size ?? 0,
      }))
      .sort((a, b) => b.day.localeCompare(a.day))
      .slice(0, 30),
    weeklyTraffic: [...weeklyPageViews.entries()]
      .map(([weekStart, views]) => ({
        weekStart,
        pageViews: views,
        uniqueVisitorSessions: weeklySessions.get(weekStart)?.size ?? 0,
      }))
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
      .slice(0, 12),
    reportsByType: ranked(reportsByType),
    topPages: ranked(topPages),
    deviceBreakdown: rankedWithPercent(deviceBreakdown, pageViews),
    topNeighborhoods: ranked(topNeighborhoods),
    topPrograms: ranked(topPrograms),
    topSupportOrganizations: ranked(topSupportOrganizations),
    topCapitalPartners: ranked(topCapitalPartners),
    recentActivity: rows
      .slice()
      .sort((a, b) => toIso(b.created_at).localeCompare(toIso(a.created_at)))
      .slice(0, 40)
      .map((row) => ({
        createdAt: toIso(row.created_at),
        eventType: row.event_type,
        reportType: row.report_type,
        address: row.address,
        source: row.source,
        summary: eventSummary(row),
      })),
    followUpQueue: options.followUpQueue ?? [],
    lifetime: options.lifetime ?? {
      users: null,
      savedReports: null,
      businessProjects: null,
      reportLeads: null,
    },
    partnerSummary: {
      headline:
        "The Explorer helped users identify incentive pathways, local support organizations, and financing resources that may be relevant to their location and goal.",
      bullets: partnerBullets,
    },
  };
}

async function safeCount(sql: SqlClient, query: "users" | "saved_reports" | "business_projects" | "report_leads") {
  try {
    if (query === "users") {
      const rows = await sql`SELECT COUNT(*)::int AS count FROM users`;
      return Number(rows[0]?.count ?? 0);
    }
    if (query === "saved_reports") {
      const rows = await sql`SELECT COUNT(*)::int AS count FROM saved_reports`;
      return Number(rows[0]?.count ?? 0);
    }
    if (query === "business_projects") {
      const rows = await sql`SELECT COUNT(*)::int AS count FROM business_projects`;
      return Number(rows[0]?.count ?? 0);
    }
    const rows = await sql`SELECT COUNT(*)::int AS count FROM report_leads`;
    return Number(rows[0]?.count ?? 0);
  } catch {
    return null;
  }
}

async function safeFollowUpQueue(sql: SqlClient): Promise<FollowUpLead[]> {
  try {
    let rows;
    try {
      rows = await sql`
        SELECT
          name,
          email,
          zip_code,
          report_address,
          report_title,
          project_goal,
          wants_incentive_help,
          delivery_source,
          email_delivered_at,
          created_at
        FROM report_leads
        ORDER BY wants_incentive_help DESC, created_at DESC
        LIMIT 30
      `;
    } catch {
      // Older databases remain readable until the first gated delivery adds
      // the consent-aware columns.
      rows = await sql`
        SELECT name, email, zip_code, report_address, report_title, created_at
        FROM report_leads
        ORDER BY created_at DESC
        LIMIT 30
      `;
    }
    return rows.map((row) => ({
      name: String(row.name ?? ""),
      email: String(row.email ?? ""),
      zipCode: String(row.zip_code ?? ""),
      reportAddress: row.report_address ? String(row.report_address) : null,
      reportTitle: row.report_title ? String(row.report_title) : null,
      projectGoal: row.project_goal ? String(row.project_goal) : null,
      wantsIncentiveHelp: Boolean(row.wants_incentive_help),
      deliverySource: row.delivery_source ? String(row.delivery_source) : null,
      emailDeliveredAt: row.email_delivered_at ? toIso(String(row.email_delivered_at)) : null,
      createdAt: toIso(String(row.created_at)),
    }));
  } catch {
    return [];
  }
}

export function normalizeAnalyticsWindow(daysParam: number) {
  return Number.isFinite(daysParam) ? Math.min(Math.max(Math.round(daysParam), 1), 365) : 30;
}

export function isValidAnalyticsToken(provided: string | null | undefined, expected: string | undefined) {
  return Boolean(expected && provided && provided === expected);
}

export async function getAnalyticsDashboardData(sql: SqlClient, daysParam: number) {
  const { ensureReportEventsTable } = await import("./server-analytics");
  await ensureReportEventsTable();
  const days = normalizeAnalyticsWindow(daysParam);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [eventRows, users, savedReports, businessProjects, reportLeads, followUpQueue] =
    await Promise.all([
      sql`
        SELECT event_type, report_type, source, address, lat, lon, metadata_json, created_at
        FROM report_events
        WHERE created_at >= ${since}
        ORDER BY created_at DESC
      `,
      safeCount(sql, "users"),
      safeCount(sql, "saved_reports"),
      safeCount(sql, "business_projects"),
      safeCount(sql, "report_leads"),
      safeFollowUpQueue(sql),
    ]);

  return summarizeAnalyticsEvents(eventRows as unknown as AnalyticsEventRow[], {
    windowDays: days,
    since,
    lifetime: {
      users,
      savedReports,
      businessProjects,
      reportLeads,
    },
    followUpQueue,
  });
}
