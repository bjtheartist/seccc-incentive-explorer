import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  OWNER_FILES_ADMIN_COOKIE,
  hasValidOwnerFilesAdminSession,
  isOwnerFilesAdminConfigured,
} from "@/lib/owner-files-admin-auth";
import { ANALYTICS_ADMIN_COOKIE } from "@/lib/analytics-admin-auth";
import { INVESTMENT_SOURCES, filterInvestmentBySources, loadCommunityInvestment } from "@/lib/community-investment";
import type { CommunityInvestmentRecord } from "@/lib/community-investment";
import { parseFunderHqCsv, type FunderHq } from "@/lib/investment-deck-modes";
import {
  summarizeCountyReliefByZip,
  summarizeHistoricalRecoveryByZip,
  type HistoricalRecoveryRecipientSource,
} from "@/lib/community-investment-layer";

// A valid analytics admin session also satisfies this gate (single sign-on
// — see lib/owner-files-admin-auth.ts module doc). Identical auth check to
// app/api/owner-file/geo/route.ts.
function isAuthorized(req: NextRequest): boolean {
  return hasValidOwnerFilesAdminSession(
    req.cookies.get(OWNER_FILES_ADMIN_COOKIE)?.value,
    req.cookies.get(ANALYTICS_ADMIN_COOKIE)?.value
  );
}

const VALID_SOURCES = new Set<string>(INVESTMENT_SOURCES);
const COUNTY_RELIEF_RECIPIENTS_VIEW = "county-relief-recipients";
const HISTORICAL_RECOVERY_RECIPIENTS_VIEW = "historical-recovery-recipients";
/**
 * Deliverable 1 (audit finding 9 / consult F6 + Q2) — the single-record lazy
 * retrieval view. RRF publishes real street addresses, so its points stay
 * PLOTTED in the default map payload (unlike the ZIP/citywide-only aggregate
 * sources), but the recipient BUSINESS NAME is withheld from that bulk
 * payload (see LAZY_RECORD_SOURCES + projectRecordForMapView below) and is
 * fetchable only one record at a time, authenticated, after an admin clicks
 * that specific point. No bulk prefetch: the client never receives more than
 * one record's identity per request.
 */
const RECIPIENT_RECORD_VIEW = "recipient-record";
/**
 * The ONLY value that unlocks raw, recipient-level rows. Everything else — a
 * missing `view`, a misspelling, a renamed enum, a copy-pasted URL that lost the
 * param — resolves to the projected, nameless shape. See `projectedView` in GET.
 */
const FULL_ROWS_VIEW = "full";
const FIVE_DIGIT_ZIP_RE = /^\d{5}$/;
const HISTORICAL_RECOVERY_RECIPIENT_CONFIG: Readonly<
  Record<
    HistoricalRecoveryRecipientSource,
    { programName: string; year: number }
  >
> = {
  "cook-source-2023": {
    programName: "Cook County 2023 Source Grant",
    year: 2023,
  },
  "illinois-big": {
    programName: "Business Interruption Grants Program",
    year: 2020,
  },
  "illinois-b2b": {
    programName: "Illinois Back to Business Grant Program",
    year: 2022,
  },
};

function isHistoricalRecoveryRecipientSource(
  value: string | null,
): value is HistoricalRecoveryRecipientSource {
  return (
    value === "cook-source-2023" ||
    value === "illinois-big" ||
    value === "illinois-b2b"
  );
}

/**
 * Source families the map may surface ONLY as aggregates. Every record in one of
 * these carries a recipient BUSINESS NAME at ZIP-or-coarser precision, and the
 * map never needs the individual row: the polygons are drawn from the
 * `*ByZip` summaries below, and names load solely through the authenticated
 * per-ZIP drilldown above.
 *
 * Membership is keyed on SOURCE, deliberately NOT on geometry. The rule here
 * used to be `geometry.kind !== "zip_area"`, which fails OPEN the instant a
 * record's geometry changes. One `illinois-big`, `illinois-b2b`, or
 * `cook-source-2023` row held CITYWIDE would have carried its business name
 * straight into the default map payload — and "hold the record citywide rather
 * than delete it" is precisely the treatment #97 applied to out-of-bounds DCEO
 * geocodes, so it is the natural next fix for BIG's one out-of-city ZIP row
 * (60426 / Harvey), which today is dropped outright. Keying on source means
 * that fix cannot silently become a name leak.
 */
const AGGREGATE_ONLY_SOURCES: ReadonlySet<string> = new Set([
  "cook-source-2023",
  "illinois-big",
  "illinois-hospitality-emergency",
  "illinois-b2b",
]);

/**
 * Sources that legitimately plot points (the source publishes street addresses)
 * but hold their unplottable remainder citywide. Only that remainder is
 * withheld: a citywide row adds nothing to the map except its recipient name.
 */
const CITYWIDE_WITHHELD_SOURCES: ReadonlySet<string> = new Set([
  "dceo-capital",
  "sba-rrf",
]);

/**
 * Deliverable 1 (audit finding 9 / consult F6 + Q2) — sources whose PLOTTED
 * point records stay on the default map (they publish real street addresses,
 * so ZIP aggregation would understate what the source published), but whose
 * recipient BUSINESS NAME is withheld from that bulk payload. The consult was
 * explicit that "the single-ZIP rule should not be absolute for a source that
 * legitimately publishes point addresses" — RRF is exactly that source, so it
 * gets its own lazy, per-record, authenticated retrieval (RECIPIENT_RECORD_VIEW
 * below) instead of being folded into the ZIP-aggregate drilldown pattern.
 */
const LAZY_RECORD_SOURCES: ReadonlySet<string> = new Set(["sba-rrf"]);

/** Whether a record may appear as an individual row in the projected map payload. */
function isVisibleInProjectedView(record: {
  source: string;
  geometry: { kind: string };
}): boolean {
  if (AGGREGATE_ONLY_SOURCES.has(record.source)) return false;
  // A ZIP-area record is an aggregate by construction, whatever its source.
  if (record.geometry.kind === "zip_area") return false;
  return !(
    CITYWIDE_WITHHELD_SOURCES.has(record.source) &&
    record.geometry.kind === "citywide"
  );
}

/**
 * Field-level projection for a record that SURVIVES isVisibleInProjectedView —
 * the second half of the projected view's trim. The map client reads a FIXED
 * subset of fields (lib/community-investment-layer.ts investmentRecordsToPointFeatures /
 * citywideInvestmentEntries / citywideDevelopmentProjectNames, rendered by
 * buildInvestmentPopupHtml in components/map/map-helpers.ts); everything else —
 * address, postalCode, recordDate, recordProvenance, every link after the first
 * http(s) one — is dead weight shipped ~32k times per layer toggle on a route
 * that is deliberately `private, no-store` (measured ~2.7 MB of the 15.9 MB
 * response, 2026-08). Built as a WHITELIST so a field added to
 * CommunityInvestmentRecord later stays OUT of the map payload until someone
 * deliberately adds it here — the same fail-closed direction as
 * isVisibleInProjectedView.
 *
 * A CITYWIDE record never plots and never opens a popup, so the client reads
 * only {source, funderType, year, amountAwarded} (the legend's re-scoping
 * citywide summary) plus `recipient` on a private_development record (the
 * Megaprojects legend's "not plotted" names). The grantee names + logLines on
 * the other ~5k citywide rows (foundation out-of-bounds geocodes, NMTC) were
 * being shipped and never rendered; they now stay server-side.
 */
type ProjectedMapPointRecord = Pick<
  CommunityInvestmentRecord,
  | "id"
  | "source"
  | "funderType"
  | "governmentFundingPurpose"
  | "funderName"
  | "recipient"
  | "capitalClass"
  | "amountAwarded"
  | "logLine"
  | "year"
  | "geometry"
  | "status"
  | "links"
> &
  Partial<
    Pick<
      CommunityInvestmentRecord,
      | "authorizedAmount"
      | "creditAmount"
      | "publishedBalance"
      | "announcedInvestment"
      | "communityArea"
      | "recovery"
    >
  >;
type ProjectedMapCitywideRecord = Pick<
  CommunityInvestmentRecord,
  | "source"
  | "funderType"
  | "governmentFundingPurpose"
  | "amountAwarded"
  | "year"
  | "geometry"
> & { recipient?: string };

function projectRecordForMapView(
  record: CommunityInvestmentRecord,
  opts?: { revealIdentity?: boolean },
): ProjectedMapPointRecord | ProjectedMapCitywideRecord {
  const {
    source,
    funderType,
    governmentFundingPurpose,
    amountAwarded,
    year,
    geometry,
  } = record;
  if (geometry.kind === "citywide") {
    const citywide: ProjectedMapCitywideRecord = {
      source,
      funderType,
      governmentFundingPurpose,
      amountAwarded,
      year,
      geometry,
    };
    if (funderType === "private_development") citywide.recipient = record.recipient;
    return citywide;
  }
  // The popup renders only the FIRST http(s) link (InvestmentPointProps.sourceLink).
  const sourceLink = record.links.find((link) => /^https?:\/\//i.test(link));
  // Deliverable 1: a LAZY_RECORD_SOURCES point (currently RRF only) keeps its
  // plottable geometry/amount/status in the bulk payload but withholds its
  // recipient BUSINESS NAME — and `logLine`, which can itself embed the legal
  // business name ("Legal business: X") — unless the caller explicitly asked
  // to reveal identity (the single-record RECIPIENT_RECORD_VIEW fetch below,
  // triggered only after an authenticated admin clicks THAT point). An empty
  // string (never the real name) signals "withheld" to the client, which shows
  // a "Reveal recipient name" action instead (components/map/map-helpers.ts).
  const withholdIdentity = LAZY_RECORD_SOURCES.has(source) && !opts?.revealIdentity;
  const projected: ProjectedMapPointRecord = {
    id: record.id,
    source,
    funderType,
    governmentFundingPurpose,
    funderName: record.funderName,
    recipient: withholdIdentity ? "" : record.recipient,
    capitalClass: record.capitalClass,
    amountAwarded,
    logLine: withholdIdentity ? null : record.logLine,
    year,
    geometry,
    status: record.status,
    links: sourceLink ? [sourceLink] : [],
  };
  if (record.authorizedAmount != null) projected.authorizedAmount = record.authorizedAmount;
  if (record.creditAmount != null) projected.creditAmount = record.creditAmount;
  if (record.publishedBalance != null) projected.publishedBalance = record.publishedBalance;
  if (record.announcedInvestment != null) projected.announcedInvestment = record.announcedInvestment;
  if (record.communityArea !== undefined) projected.communityArea = record.communityArea;
  if (record.recovery !== undefined) projected.recovery = record.recovery;
  return projected;
}

/**
 * The 12 foundation headquarters (data/curated/foundation-hqs.csv) that seed the
 * map layer's Arcs mode (source = funder HQ → target = recipient point). Read
 * and parsed ONCE per process, server-side only, so the client receives the
 * coordinates inside this gated JSON response and never fetches a raw data-file
 * path. `undefined` = not attempted yet; a missing/unparseable file degrades to
 * an empty array (Arcs mode simply has nothing to draw arcs from).
 */
const FUNDER_HQS_PATH = path.join(process.cwd(), "data/curated/foundation-hqs.csv");
let funderHqsCache: FunderHq[] | undefined;

function loadFunderHqs(): FunderHq[] {
  if (funderHqsCache !== undefined) return funderHqsCache;
  try {
    funderHqsCache = existsSync(FUNDER_HQS_PATH)
      ? parseFunderHqCsv(readFileSync(FUNDER_HQS_PATH, "utf8"))
      : [];
  } catch {
    funderHqsCache = [];
  }
  return funderHqsCache;
}

/**
 * GET /api/owner-file/investment?source=cdg,foundation — the private Community
 * Investment dataset (data/private/community-investment.json), gated behind the
 * same Owner Files admin session as the other owner-file routes. The records
 * carry grantee/business names + street addresses (more sensitive than the
 * public vacant-properties layer), so this is never cached beyond the request
 * and never served unauthenticated.
 *
 * `source` is an optional comma-separated filter over the investment
 * sources (invalid entries dropped); omitted or empty returns every record.
 */
export async function GET(req: NextRequest) {
  if (!isOwnerFilesAdminConfigured()) {
    return NextResponse.json({ error: "Owner Files admin auth is not configured" }, { status: 503 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const data = loadCommunityInvestment();
  if (!data) {
    return NextResponse.json(
      { error: "Community Investment export has not been generated yet" },
      { status: 503 }
    );
  }

  const view = req.nextUrl.searchParams.get("view");
  if (
    view === COUNTY_RELIEF_RECIPIENTS_VIEW ||
    view === HISTORICAL_RECOVERY_RECIPIENTS_VIEW
  ) {
    const zipCode = req.nextUrl.searchParams.get("zip")?.trim() ?? "";
    if (!FIVE_DIGIT_ZIP_RE.test(zipCode)) {
      return NextResponse.json(
        { error: "A five-digit ZIP code is required" },
        { status: 400, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    const requestedSource =
      view === COUNTY_RELIEF_RECIPIENTS_VIEW
        ? "cook-source-2023"
        : req.nextUrl.searchParams.get("source");
    if (!isHistoricalRecoveryRecipientSource(requestedSource)) {
      return NextResponse.json(
        { error: "A supported historical recovery source is required" },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const config = HISTORICAL_RECOVERY_RECIPIENT_CONFIG[requestedSource];

    const recipientRecords = data.records
      .filter(
        (record) =>
          record.source === requestedSource &&
          record.geometry.kind === "zip_area" &&
          record.geometry.zip === zipCode
      )
      .sort((a, b) => a.recipient.localeCompare(b.recipient, "en-US"));
    const sourceLink =
      recipientRecords
        .flatMap((record) => record.links)
        .find((link) => /^https?:\/\//i.test(link)) ?? null;

    return NextResponse.json(
      {
        sourceId: requestedSource,
        zipCode,
        programName: config.programName,
        programStatus: "complete",
        year: config.year,
        recipientCount: recipientRecords.length,
        sourceLink,
        recipients: recipientRecords.map((record) => ({
          id: record.id,
          businessName: record.recipient,
          historicalAwardAmount:
            record.recovery?.historicalAmount?.value ??
            record.amountAwarded,
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  }

  if (view === RECIPIENT_RECORD_VIEW) {
    // Deliverable 1 (audit finding 9 / consult F6 + Q2) — the lazy, per-record,
    // authenticated identity fetch for a LAZY_RECORD_SOURCES point (RRF). Auth
    // already happened above, before `data` was ever loaded. No bulk prefetch:
    // this returns EXACTLY the fields the popup withheld for ONE record id,
    // never a list, never every RRF record, and only for a source enrolled in
    // LAZY_RECORD_SOURCES — a non-enrolled id (or an unknown id) 404s rather
    // than confirming/denying whether that id exists, so this endpoint cannot
    // be used to probe ids belonging to a different, unrelated gate.
    const id = req.nextUrl.searchParams.get("id")?.trim() ?? "";
    if (!id) {
      return NextResponse.json(
        { error: "A record id is required" },
        { status: 400, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    const record = data.records.find((r) => r.id === id);
    if (!record || !LAZY_RECORD_SOURCES.has(record.source)) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    return NextResponse.json(
      { id: record.id, recipient: record.recipient, logLine: record.logLine },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  }

  const sourceParam = req.nextUrl.searchParams.get("source");
  const sources = sourceParam
    ? sourceParam
        .split(",")
        .map((s) => s.trim())
        .filter((s) => VALID_SOURCES.has(s))
    : null;

  const filtered = filterInvestmentBySources(data, sources);
  /**
   * FAIL CLOSED. The projected, NAMELESS shape is the default; raw
   * recipient-level rows require an explicit `view=full`.
   *
   * This used to be inverted — only the exact string "map" was projected, and
   * everything else fell through to the raw rows. That meant a bare
   * `GET /api/owner-file/investment` returned every `cook-source-2023`,
   * `illinois-b2b`, and `sba-rrf` recipient BUSINESS NAME in one payload, and so
   * did `?view=maps`, `?view=banana`, or any future rename of the enum. The most
   * identifying response shape was opt-in, behind an exact string match, which is
   * the wrong direction for a default: a typo silently upgraded the payload
   * instead of degrading it.
   *
   * Now a typo degrades to aggregates. The README's promise — "the map receives
   * ZIP aggregates; recipient names load only after an authenticated user
   * explicitly opens one ZIP's historical-recipient panel" — is enforced by the
   * route rather than merely observed by today's callers.
   */
  const projectedView = view !== FULL_ROWS_VIEW;
  const responseData = projectedView
    ? {
        ...filtered,
        // The map needs ZIP aggregates, not recipient names. Keep raw
        // recipient-level rows available only through the explicit
        // authenticated drilldown while making the normal map payload smaller
        // and less identifying. See isVisibleInProjectedView: the rule is keyed
        // on source, so it cannot fail open on a geometry change. The surviving
        // records are then field-projected (projectRecordForMapView) down to
        // what the map client actually renders.
        records: filtered.records.filter(isVisibleInProjectedView).map((r) => projectRecordForMapView(r)),
        countyReliefByZip: summarizeCountyReliefByZip(filtered.records),
        state2020ReliefByZip: summarizeHistoricalRecoveryByZip(
          filtered.records,
          "illinois-big",
        ),
        stateRecoveryByZip: summarizeHistoricalRecoveryByZip(
          filtered.records,
          "illinois-b2b",
        ),
        stateCapitalCitywideCount: filtered.records.filter(
          (record) => record.source === "dceo-capital" && record.geometry.kind === "citywide",
        ).length,
        federalRestaurantReliefCitywideCount: filtered.records.filter(
          (record) => record.source === "sba-rrf" && record.geometry.kind === "citywide",
        ).length,
        state2020HospitalityCitywideCount: filtered.records.filter(
          (record) =>
            record.source === "illinois-hospitality-emergency" &&
            record.geometry.kind === "citywide",
        ).length,
      }
    : filtered;
  // Attach the funder-HQ coordinates so the client's Arcs mode can draw HQ →
  // recipient arcs without ever fetching the raw CSV path. `funderHqs` is
  // additive to the CommunityInvestmentExport shape and ignored by clients that
  // don't read it (e.g. the existing dots layer).
  return NextResponse.json(
    { ...responseData, funderHqs: loadFunderHqs() },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
