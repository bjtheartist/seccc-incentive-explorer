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
import { parseFunderHqCsv, type FunderHq } from "@/lib/investment-deck-modes";
import { summarizeCountyReliefByZip } from "@/lib/community-investment-layer";

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
const FIVE_DIGIT_ZIP_RE = /^\d{5}$/;

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
  if (view === COUNTY_RELIEF_RECIPIENTS_VIEW) {
    const zipCode = req.nextUrl.searchParams.get("zip")?.trim() ?? "";
    if (!FIVE_DIGIT_ZIP_RE.test(zipCode)) {
      return NextResponse.json(
        { error: "A five-digit ZIP code is required" },
        { status: 400, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    const recipientRecords = data.records
      .filter(
        (record) =>
          record.source === "cook-source-2023" &&
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
        zipCode,
        programName: "Cook County 2023 Source Grant",
        programStatus: "complete",
        year: 2023,
        recipientCount: recipientRecords.length,
        sourceLink,
        recipients: recipientRecords.map((record) => ({
          id: record.id,
          businessName: record.recipient,
          historicalAwardAmount: record.amountAwarded,
        })),
      },
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
  const mapView = view === "map";
  const responseData = mapView
    ? {
        ...filtered,
        // The map needs ZIP aggregates, not 1,163 recipient names. Keep the raw
        // rows available to an authorized explicit source request while making
        // the normal map payload smaller and less identifying.
        records: filtered.records.filter(
          (record) =>
            record.source !== "cook-source-2023" &&
            !(record.source === "dceo-capital" && record.geometry.kind === "citywide"),
        ),
        countyReliefByZip: summarizeCountyReliefByZip(filtered.records),
        stateCapitalCitywideCount: filtered.records.filter(
          (record) => record.source === "dceo-capital" && record.geometry.kind === "citywide",
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
