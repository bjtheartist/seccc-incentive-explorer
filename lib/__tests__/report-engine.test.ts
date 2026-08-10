import { describe, expect, it } from "vitest";
import {
  CONFIRMED_PROGRAMS_SECTION_TITLE,
  generateReportData,
  GOAL_MATCH_PROGRAMS_SECTION_TITLE,
  normalizePublicReportForDisplay,
  OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
} from "../report-engine";
import type { GeneratedReport } from "../report-engine";
import type { Program } from "../types";
import citywideSupportData from "@/data/curated/citywide_business_support_resources.json";
import supportData from "@/data/exports/chicago-neighborhood-economics/local_business_support_by_community_area.json";
import {
  mergeCitywideBusinessSupport,
  rankLocalBusinessSupport,
  type LocalBusinessSupportContext,
  type LocalBusinessSupportOrganization,
  type LocalBusinessSupportRequest,
} from "../local-business-support";
import { CAPITAL_PARTNER_SECTION_TITLE } from "../capital-partner-report";
import {
  SUPPORT_ORGANIZATIONS_CAPACITY_NOTE,
  SUPPORT_ORGANIZATIONS_DESCRIPTION,
  SUPPORT_ORGANIZATIONS_SECTION_TITLE,
} from "../support-organization-copy";

/**
 * Words that assert a use permission. Anything that answers "may I do this
 * here?" belongs on this list; only the City can answer that question.
 */
const CLAIM_WORDS =
  "permitted|allowed|prohibited|banned|barred|permissible|by[-\\s]?right|as[-\\s]of[-\\s]right";

/**
 * Proximity, not adjacency. The earlier patterns demanded the claim word sit
 * directly beside "use(s)" ("uses are permitted"), which any normal sentence
 * slips past — "Business uses are generally permitted" reads identically to a
 * user and matched nothing. Here the claim word only has to land within the
 * same sentence-ish window as "use(s)", in either order, so a new permission
 * claim fails the suite the moment it is written.
 */
const PERMISSION_CLAIM_PATTERNS: RegExp[] = [
  new RegExp(`\\buses?\\b[^.]{0,40}\\b(?:${CLAIM_WORDS})\\b`, "i"),
  new RegExp(`\\b(?:${CLAIM_WORDS})\\b[^.]{0,40}\\buses?\\b`, "i"),
  /\bpermits?\b[^.]{0,40}\buses?\b/i,
  /most business uses/i,
  /Use Compatibility/i,
];

/**
 * The sanctioned DISCLAIMING forms, which say the report does NOT decide the
 * question. These are exact published phrases, not loose exemptions, so they
 * cannot launder an affirmative claim.
 */
const SANCTIONED_DISCLAIMERS: RegExp[] = [
  /does not determine whether a proposed use is permitted/gi,
  /does not establish that a proposed use is permitted/gi,
  /Verify whether a proposed use is permitted/gi,
  /does not classify the proposed activity or determine that a use is permitted/gi,
  /does not classify the proposed activity/gi,
  /does not establish current authorization, permitted use, or compliance/gi,
];

/** Remove the sanctioned disclaimers so only affirmative claims remain. */
function stripSanctionedDisclaimers(copy: string): string {
  return SANCTIONED_DISCLAIMERS.reduce(
    (text, pattern) => text.replace(pattern, ""),
    copy,
  );
}

function makeProgram(overrides: Partial<Program> = {}): Program {
  return {
    id: "tif",
    name: "TIF Program",
    level: "City",
    zoneKey: "tif",
    summary: "A test program",
    whoQualifies: "Businesses in the matching zone",
    benefits: ["Grant"],
    howToApply: ["Confirm program fit", "Open the official source"],
    requiredDocs: ["Project budget"],
    contact: "test@example.com",
    url: "https://example.com/program",
    contacts: [
      {
        agency: "Test Agency",
        abbreviation: "TA",
        phone: "312-555-0000",
      },
    ],
    eligibilityRules: [
      {
        criterion: "location",
        description: "Must be in a TIF district",
        verifiedBy: "location",
        required: true,
      },
    ],
    lastVerifiedAt: new Date().toISOString(),
    benefitRange: "$10K-$50K",
    fastestConfirmingStep: "Call the program administrator",
    ...overrides,
  };
}

/**
 * The rank limit /api/local-business-support passes to
 * rankLocalBusinessSupport. It matches the engine's display cap, which is why
 * a full-length payload is indistinguishable from a truncated one.
 */
const SUPPORT_ORGANIZATION_API_LIMIT = 6;
const AUSTIN_COMMUNITY_AREA = "25";

function austinSupportEntry(): LocalBusinessSupportContext {
  const file = supportData as unknown as {
    byCommunityArea: Record<string, LocalBusinessSupportContext>;
  };
  return file.byCommunityArea[AUSTIN_COMMUNITY_AREA];
}

/**
 * Reproduce the payload the report actually receives in production: the route
 * merges citywide resources into the community-area entry and returns
 * rankLocalBusinessSupport(pool, 6) with no pre-cap total attached.
 */
function austinSupportContextAsTheApiReturnsIt(): LocalBusinessSupportContext {
  const entry = austinSupportEntry();
  const request: LocalBusinessSupportRequest = {
    communityAreaNumber: AUSTIN_COMMUNITY_AREA,
    communityArea: entry.communityArea,
    region: entry.region,
    reportType: "site-incentives",
  };
  const citywide = citywideSupportData as unknown as {
    organizations: LocalBusinessSupportOrganization[];
  };
  const pool = mergeCitywideBusinessSupport(
    entry.organizations,
    citywide.organizations,
    request,
  );
  return {
    ...entry,
    organizations: rankLocalBusinessSupport(pool, SUPPORT_ORGANIZATION_API_LIMIT, request),
  };
}

const zones = { tif: true, sbif: false, federalOZ: false };
const zoneNames = { tif: "Test TIF" };
type ReportState = Parameters<typeof generateReportData>[0];

function makeState(overrides: Partial<ReportState> = {}): ReportState {
  return {
    reportType: "site-incentives",
    address: "100 E Test St",
    lat: 41.8,
    lon: -87.6,
    neighborhood: "",
    industry: "",
    budgetRange: "",
    projectGoals: [],
    projectType: "",
    customGoal: "",
    proposedUse: "",
    fundingCommitted: "",
    remainingGap: "",
    timeline: "",
    siteControl: "",
    documentsAvailable: [],
    jobsImpact: "",
    supportNeeded: [],
    creditsToAnalyze: [],
    ...overrides,
  };
}

describe("generateReportData", () => {
  it("attaches a source-backed financing resource to capital-shaped reports", () => {
    const report = generateReportData(
      makeState({ projectType: "equipment" }),
      [makeProgram()],
      { zones, zoneNames, reportZip: "60617" },
    );

    expect(report.capitalPartnerHandoff?.primary?.partnerId).toBe("somercor");
    const section = report.sections.find(
      (candidate) => candidate.title === CAPITAL_PARTNER_SECTION_TITLE,
    );
    expect(section?.items[0]).toMatchObject({
      label: "SomerCor",
      partnerId: "somercor",
      value: "Financing resource to explore",
    });
    expect(section?.description).toContain("listings are informational");
    expect(section?.description).toContain("reviews may apply");
    expect(section?.description).toContain("no contact information has been shared");
  });

  it("does not add a lender handoff to a hiring-only report without a capital request", () => {
    const report = generateReportData(
      makeState({ projectType: "hiring" }),
      [makeProgram()],
      { zones, zoneNames },
    );

    expect(report.capitalPartnerHandoff).toBeUndefined();
    expect(report.sections.some((section) => section.title === CAPITAL_PARTNER_SECTION_TITLE)).toBe(false);
  });

  it("attaches executive summaries to current site-incentives reports", () => {
    const report = generateReportData(
      makeState(),
      [makeProgram()],
      { zones, zoneNames },
    );

    expect(report.reportType).toBe("site-incentives");
    expect(report.executiveSummary).toBeDefined();
    expect(report.executiveSummary?.zoneCount).toBe(1);
    expect(report.executiveSummary?.topPrograms.map((p) => p.programId)).toContain("tif");
    expect(report.locationContext?.geography.zones.value).toEqual(["tif"]);
    expect(report.locationContext).not.toHaveProperty("programs");
  });

  it("frames address-linked programs as a fit check before application", () => {
    const report = generateReportData(
      makeState({ projectType: "equipment" }),
      [makeProgram()],
      { zones, zoneNames },
    );

    expect(report.recommendedActions[0]?.label).toBe("Confirm fit for TIF Program");
    expect(report.recommendedActions[0]?.label).not.toContain("Apply for");
    expect(report.summary).toContain("Start with the recommended actions");
  });

  it("attaches executive summaries to current dev-feasibility reports", () => {
    const report = generateReportData(
      makeState({
        reportType: "dev-feasibility",
        projectType: "rehab",
      }),
      [makeProgram()],
      { zones, zoneNames },
    );

    expect(report.reportType).toBe("dev-feasibility");
    expect(report.executiveSummary).toBeDefined();
    expect(report.executiveSummary?.zoneCount).toBe(1);
  });

  it.each([
    ["RS-3", "Residential"],
    ["B3-2", "Business"],
    ["M1-2", "Manufacturing"],
  ])(
    "preserves the published %s classification without inferring permitted uses",
    (zoneClass, zoneType) => {
      const report = generateReportData(
        makeState({
          reportType: "dev-feasibility",
          projectType: "rehab",
        }),
        [makeProgram()],
        {
          zones,
          zoneNames,
          cityZoning: { zoneClass, zoneType },
        },
      );

      const zoningSection = report.sections.find(
        (section) => section.title === "Zoning & Regulatory Review",
      );
      const zoningCopy = JSON.stringify(zoningSection);

      expect(zoningSection?.description).toContain("Published City zoning classification");
      expect(zoningSection?.items).toHaveLength(1);
      expect(zoningSection?.items[0]).toMatchObject({
        label: "City Zoning Classification",
        value: zoneClass,
      });
      expect(zoningSection?.items[0].detail).toContain(
        "This report does not determine whether a proposed use is permitted",
      );
      expect(zoningSection?.items[0].detail).toContain(
        "Verify the intended use and project requirements",
      );
      expect(zoningCopy).not.toContain("Use Compatibility");
      expect(zoningCopy).not.toContain("Most business uses are permitted by right");
      expect(zoningCopy).not.toContain("Commercial uses may require a zoning change");
      expect(zoningCopy).not.toContain("Manufacturing, warehouse, and some commercial uses are permitted");
    },
  );

  /**
   * The three literal strings above only catch the copy we already removed.
   * This guard is shape-based, so a NEW permitted-use claim for any district
   * family fails the suite the moment it is written. Only the disclaiming form
   * ("does NOT determine whether a proposed use is permitted") is allowed,
   * so the affirmative patterns are matched and the negated ones exempted.
   */
  it.each([
    "RS-3",
    "B3-2",
    "M1-2",
    "C1-1.5",
    "DX-10",
    "PD 1376",
    "PMD 11",
  ])(
    "never asserts what uses are allowed in %s",
    (zoneClass) => {
      const report = generateReportData(
        makeState({ reportType: "dev-feasibility", projectType: "rehab" }),
        [makeProgram()],
        { zones, zoneNames, cityZoning: { zoneClass, zoneType: null } },
      );

      const affirmative = stripSanctionedDisclaimers(JSON.stringify(report));

      for (const pattern of PERMISSION_CLAIM_PATTERNS) {
        expect(affirmative).not.toMatch(pattern);
      }
    },
  );

  /**
   * The guard above is only worth as much as its patterns. The originals
   * required the claim word to sit immediately beside "use(s)", so ordinary
   * phrasings walked straight through: "Business uses are generally permitted"
   * and "by-right uses include" both passed clean. These cases pin the
   * proximity form in place — and pin the sanctioned disclaimers as still
   * allowed, so the guard cannot be "fixed" by making it reject the honest
   * copy the reports depend on.
   */
  describe("the permitted-use guard's own patterns", () => {
    it.each([
      "Business uses are generally permitted",
      "by-right uses include retail and office",
      "Residential uses are typically allowed in this district",
      "Industrial uses may be prohibited here",
      "Most uses in this district are permitted as of right",
      "This district permits the following uses by right",
      "Retail use is allowed",
      "Use Compatibility",
      "Most business uses are permitted by right",
    ])("fails a new permission claim: %s", (claim) => {
      const affirmative = stripSanctionedDisclaimers(claim);
      expect(
        PERMISSION_CLAIM_PATTERNS.some((pattern) => pattern.test(affirmative)),
      ).toBe(true);
    });

    it.each([
      "This report does not determine whether a proposed use is permitted.",
      "The published district alone does not establish that a proposed use is permitted or that zoning relief is required.",
      "Verify whether a proposed use is permitted against the current Chicago Zoning Ordinance.",
      "A past judgment does not establish current authorization, permitted use, or compliance.",
      "It does not classify the proposed activity or determine that a use is permitted.",
    ])("still allows the disclaiming form: %s", (disclaimer) => {
      const affirmative = stripSanctionedDisclaimers(disclaimer);
      for (const pattern of PERMISSION_CLAIM_PATTERNS) {
        expect(affirmative).not.toMatch(pattern);
      }
    });
  });

  it("puts published zoning and a verification action first in site reports", () => {
    const report = generateReportData(
      makeState({ projectGoals: ["rehab"], projectType: "rehab" }),
      [makeProgram()],
      {
        zones,
        zoneNames,
        cityZoning: {
          status: "available",
          zoneClass: "B3-2",
          zoneType: "Business",
          source: {
            id: "chicago-arcgis-zoning",
            label: "City of Chicago ArcGIS zoning boundaries",
            url: "https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Zoning/MapServer/1",
            retrievedAt: "2026-08-09T12:00:00.000Z",
            recordUpdatedAt: null,
          },
        },
      },
    );

    expect(report.sections[0]?.title).toBe("Zoning & Use Starting Point");
    expect(report.sections[0]?.description).toContain("does not classify the proposed activity");
    expect(report.actionRoadmap?.[0]?.label).toContain("verify its use category for B3-2");
    expect(report.actionRoadmap?.[0]?.description).toContain("does not establish");
  });

  it("links an exact City-published Clerk matter without inferring use compatibility", () => {
    const clerkUrl =
      "https://chicityclerkelms.chicago.gov/Matter/?matterId=14999C67-FD08-F111-8406-001DD80D78DD";
    const report = generateReportData(
      makeState({ reportType: "dev-feasibility", projectType: "rehab" }),
      [makeProgram()],
      {
        zones,
        zoneNames,
        cityZoning: {
          zoneClass: "B1-3",
          zoneType: null,
          clerkDocumentNumber: "O2026-0023281",
          clerkUrl,
          ordinanceDate: "2026-05-20T00:00:00.000Z",
        },
      },
    );
    const item = report.sections
      .find((section) => section.title === "Zoning & Regulatory Review")
      ?.items[0];
    expect(item?.url).toBe(clerkUrl);
    expect(item?.detail).toContain("Related City Clerk record: O2026-0023281");
    expect(item?.detail).toContain("Published ordinance date: 2026-05-20");
    expect(item?.detail).toContain("does not determine whether a proposed use is permitted");
  });

  it("shows cited historical ZBA records with verification guardrails and no duplicate zoning section", () => {
    const zoningSource = {
      id: "chicago-arcgis-zoning" as const,
      label: "City of Chicago ArcGIS zoning boundaries",
      url: "https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Zoning/MapServer/1",
      retrievedAt: "2026-08-08T12:00:00.000Z",
      recordUpdatedAt: null,
    };
    const zbaSource = {
      id: "chicago-zba-arcgis" as const,
      label: "City of Chicago Zoning Board of Appeals case layer",
      url: "https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Zoning_update/MapServer/16",
      boardUrl: "https://www.chicago.gov/city/en/depts/dcd/zoning-board-of-appeals.html",
      retrievedAt: "2026-08-08T12:00:00.000Z",
      sourceUpdatedAt: null,
      freshnessNote:
        "The City layer does not publish a refresh timestamp. Retrieval time is not a source-update date.",
    };
    const report = generateReportData(
      makeState({ reportType: "dev-feasibility", projectType: "rehab" }),
      [makeProgram()],
      {
        zones,
        zoneNames,
        cityZoning: {
          status: "available",
          zoneClass: "B3-2",
          zoneType: null,
          source: zoningSource,
          zba: {
            status: "available",
            returnedCount: 1,
            coverage: "complete",
            source: zbaSource,
            message: "Historical City ZBA records whose published geometry intersects this point.",
            cases: [{
              id: "zba-1",
              globalId: "zba-1",
              caseReference: "71-25-Z",
              caseYear: 2025,
              caseSequence: 71,
              caseType: "variation",
              caseTypeRaw: "Z",
              address: "118 S CLINTON ST",
              judgment: "Aproved/Cont.",
              description: "Published case description.",
              pin10: "1716101001",
              pinAccuracy: "MATCHED",
              publishedYearField: "71",
              publishedCaseField: "2025",
            }],
          },
        },
      },
    );

    const zoningSections = report.sections.filter(
      (section) => section.title === "Zoning & Regulatory Review",
    );
    expect(zoningSections).toHaveLength(1);
    expect(zoningSections[0].description).toContain("not a City zoning determination");
    expect(zoningSections[0].items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Variation · 71-25-Z",
          value: "Aproved/Cont.",
          url: zbaSource.url,
        }),
      ]),
    );
    expect(JSON.stringify(zoningSections[0])).toContain("does not establish current authorization");
    expect(JSON.stringify(zoningSections[0])).toContain("use the Query tool");
    expect(report.dataSources?.find((item) => item.id === "chicagoZba")?.description)
      .toContain("does not publish a refresh timestamp");
    expect(report.dataSources?.find((item) => item.id === "chicagoZbaBoard")?.url)
      .toBe(zbaSource.boardUrl);
  });

  it("preserves explicit unavailable and not-found zoning states", () => {
    const unavailable = generateReportData(
      makeState({ reportType: "dev-feasibility", projectType: "rehab" }),
      [makeProgram()],
      {
        zones,
        zoneNames,
        cityZoning: {
          status: "unavailable",
          zoneClass: null,
          zoneType: null,
          source: null,
          message: "Published Chicago zoning data is temporarily unavailable.",
        },
      },
    );
    const unavailableCopy = JSON.stringify(unavailable);
    expect(unavailableCopy).toContain("Temporarily unavailable");
    expect(unavailableCopy).toContain("No zoning conclusion is shown");
    expect(unavailable.dataSources?.some((source) => source.id === "zoning")).toBe(false);

    const source = {
      id: "chicago-arcgis-zoning" as const,
      label: "City of Chicago ArcGIS zoning boundaries",
      url: "https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Zoning/MapServer/1",
      retrievedAt: "2026-08-08T12:00:00.000Z",
      recordUpdatedAt: null,
    };
    const notFound = generateReportData(
      makeState({ reportType: "dev-feasibility", projectType: "rehab" }),
      [makeProgram()],
      {
        zones,
        zoneNames,
        cityZoning: {
          status: "not_found",
          zoneClass: null,
          zoneType: null,
          source,
          message: "No published Chicago zoning district was returned.",
        },
      },
    );
    const notFoundCopy = JSON.stringify(notFound);
    expect(notFoundCopy).toContain("No district returned");
    expect(notFoundCopy).toContain(
      "not a finding that zoning requirements do not apply",
    );
    expect(notFound.dataSources?.find((item) => item.id === "zoning")).toMatchObject({
      label: source.label,
      url: source.url,
    });
  });

  it("cites the actual fallback source and record freshness", () => {
    const report = generateReportData(
      makeState({ reportType: "dev-feasibility", projectType: "rehab" }),
      [makeProgram()],
      {
        zones,
        zoneNames,
        cityZoning: {
          status: "available",
          zoneClass: "C1-3",
          zoneType: null,
          recordUpdatedAt: "2025-03-05T00:00:00.000Z",
          source: {
            id: "chicago-data-portal-zoning",
            label: "City of Chicago Data Portal zoning boundaries",
            url: "https://data.cityofchicago.org/d/dj47-wfun",
            retrievedAt: "2026-08-08T12:00:00.000Z",
            recordUpdatedAt: "2025-03-05T00:00:00.000Z",
          },
        },
      },
    );

    expect(report.dataSources?.find((source) => source.id === "zoning")).toMatchObject({
      label: "City of Chicago Data Portal zoning boundaries",
      url: "https://data.cityofchicago.org/d/dj47-wfun",
    });
    expect(
      report.dataSources?.find((source) => source.id === "zoning")?.description,
    ).toContain("Source record updated 2025-03-05");
  });

  it("keeps no-zone programs out of address-confirmed eligibility claims", () => {
    const globalProgram = makeProgram({
      id: "global",
      name: "Global Program",
      level: "Federal",
      zoneKey: "",
      eligibilityRules: [],
    });

    const report = generateReportData(
      makeState(),
      [globalProgram],
      { zones: {}, zoneNames: {} },
    );

    expect(report.summary).toContain("links 0 programs to this address");
    expect(report.executiveSummary?.topPrograms).toEqual([]);
    expect(report.sections.find((s) => s.title === CONFIRMED_PROGRAMS_SECTION_TITLE)).toBeUndefined();
    expect(report.sections.find((s) => s.title === "Additional Programs to Explore")?.items[0].programId).toBe("global");
  });

  it("adds logistics access and site signals to Site Facts", () => {
    const report = generateReportData(
      makeState(),
      [makeProgram()],
      {
        zones,
        zoneNames,
        transport: {
          expressway: { name: "I-90", miles: 1.2 },
          rail: { name: "NS Chicago Line", miles: 0.3 },
          midwayMiles: 8.7,
          ohareMiles: 19.1,
        },
        siteSignals: {
          nofAwardsNearby: 2,
          incentiveParcelsNearby: 1,
          brownfield: { name: "Former industrial site", miles: 0.4 },
          openLustNearby: 1,
          nearestOpenLust: { name: "Open LUST incident", miles: 0.2 },
          nearestIncentiveParcel: { name: "Class 7b parcel", miles: 0.1 },
        },
      },
    );

    const siteFacts = report.sections.find((section) => section.title === "Site Facts");
    expect(siteFacts?.description).toContain("transportation");
    expect(siteFacts?.items.find((item) => item.label === "Logistics Access")?.value).toContain("I-90");
    expect(siteFacts?.items.find((item) => item.label === "Logistics Access")?.detail).toContain("Straight-line distance only");
    expect(siteFacts?.items.find((item) => item.label === "Logistics Access")?.sourceLabel).toBe("Transportation and logistics access layer");
    expect(siteFacts?.items.find((item) => item.label === "Site Signals")?.value).toContain("nearby public-data");
    expect(siteFacts?.items.find((item) => item.label === "Site Signals")?.detail).toContain("NOF grants funded within 1/2 mi: 2");
    expect(siteFacts?.items.find((item) => item.label === "Site Signals")?.detail).toContain("verify with DPD");
    expect(siteFacts?.items.find((item) => item.label === "Site Signals")?.sourceLabel).toBe("Public site-signal layers");
    expect(report.locationContext?.site.siteSignals?.kind).toBe("proximity");
    expect(report.locationContext?.site.transport?.kind).toBe("proximity");
    expect(report.dataSources?.map((source) => source.id)).toEqual(
      expect.arrayContaining(["siteSignals", "transport"])
    );
  });

  it("prefers transportation and site access context when richer mobility data is available", () => {
    const report = generateReportData(
      makeState(),
      [makeProgram()],
      {
        zones,
        zoneNames,
        transport: {
          expressway: { name: "I-90", miles: 1.2 },
          rail: { name: "NS Chicago Line", miles: 0.3 },
          midwayMiles: 8.7,
          ohareMiles: 19.1,
        },
        mobilityAccess: {
          transitLabel: "Strong public transit access",
          bikeLabel: "Nearby bike access",
          driveLabel: "Good drive access",
          freightLabel: "Freight rail nearby",
          ctaRailStations: [
            {
              name: "79th",
              category: "cta_rail",
              agency: "CTA",
              miles: 0.2,
              lat: 41.7504,
              lon: -87.6251,
              sourceId: "cta-gtfs",
            },
          ],
          metraStations: [],
          busStops: [
            {
              name: "79th Red Line Station",
              category: "bus_stop",
              agency: "CTA",
              miles: 0.1,
              lat: 41.7508,
              lon: -87.625,
              routes: ["75", "79"],
              sourceId: "cta-bus-stops",
            },
          ],
          bikeRoutes: [
            {
              name: "STATE ST - 79TH ST to 75TH ST",
              category: "bike_route",
              miles: 0.1,
              routeType: "Buffered Bike Lane",
              sourceId: "city-bike-routes",
            },
          ],
          airports: [
            {
              name: "Chicago Midway International",
              category: "airport",
              agency: "Airport",
              miles: 8.7,
              lat: 41.7868,
              lon: -87.7522,
              sourceId: "airports",
            },
          ],
          expressways: [
            {
              name: "Dan Ryan Expy (I-90/94)",
              category: "expressway",
              miles: 1.2,
              sourceId: "transport-network",
            },
          ],
          freightRail: [
            {
              name: "NS Chicago Line",
              category: "freight_rail",
              miles: 0.3,
              sourceId: "transport-network",
            },
          ],
          sources: [],
          caveats: ["Distances are straight-line proximity signals, not routed travel times."],
          refreshedAt: "2026-07-09T00:00:00.000Z",
        },
      },
    );

    const siteFacts = report.sections.find((section) => section.title === "Site Facts");
    const mobilityItem = siteFacts?.items.find((item) => item.label === "Transportation & Site Access");
    expect(mobilityItem?.value).toContain("Strong public transit access");
    expect(mobilityItem?.detail).toContain("CTA rail: 79th · 0.2 mi");
    expect(mobilityItem?.detail).toContain(
      "CTA bus: 79th Red Line Station · Routes 75, 79 · 0.1 mi",
    );
    expect(mobilityItem?.detailGroups).toEqual(
      expect.arrayContaining([
        {
          id: "cta-bus",
          label: "CTA bus",
          items: ["79th Red Line Station · Routes 75, 79 · 0.1 mi"],
        },
        {
          id: "bike-routes",
          label: "Bike routes",
          items: ["Buffered Bike Lane · State St - 79th St to 75th St · 0.1 mi"],
        },
      ]),
    );
    expect(mobilityItem?.detailCaveat).toBe(
      "Distances are straight-line proximity signals, not routed travel times.",
    );
    expect(siteFacts?.items.find((item) => item.label === "Logistics Access")).toBeUndefined();
    expect(report.locationContext?.site.mobilityAccess?.kind).toBe("proximity");
    expect(report.dataSources?.map((source) => source.id)).toEqual(
      expect.arrayContaining(["mobilityAccess"])
    );
  });

  it("prioritizes confirmed programs by the user's selected goal without exposing scores", () => {
    const report = generateReportData(
      makeState({ projectType: "hiring" }),
      [
        makeProgram({
          id: "edge",
          name: "Economic Development for a Growing Economy (EDGE)",
        }),
        makeProgram({
          id: "sbif",
          name: "Small Business Improvement Fund (SBIF)",
        }),
        makeProgram({
          id: "dataCenter",
          name: "Illinois Data Center Investment Program",
        }),
      ],
      { zones, zoneNames },
    );

    const bestMatches = report.sections.find(
      (section) => section.title === GOAL_MATCH_PROGRAMS_SECTION_TITLE,
    );
    const otherMatches = report.sections.find(
      (section) => section.title === OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
    );
    const edge = bestMatches?.items.find((item) => item.programId === "edge");
    const dataCenter = otherMatches?.items.find((item) => item.programId === "dataCenter");

    expect(bestMatches?.items[0].programId).toBe("edge");
    expect(edge).not.toHaveProperty("projectFit");
    expect(otherMatches?.items.map((item) => item.programId)).toEqual(
      expect.arrayContaining(["sbif", "dataCenter"]),
    );
    expect(dataCenter).not.toHaveProperty("confidenceLevel");
    expect(dataCenter?.matchExplanation?.knownFromPublicData[0]).toContain("recorded within");
    expect(dataCenter).not.toHaveProperty("projectFit");
    expect(JSON.stringify(report)).not.toContain('"score"');
    expect(report.executiveSummary?.projectGoalLabel).toBe("Hire or retain employees");
    expect(report.executiveSummary?.topPrograms[0].programId).toBe("edge");
    expect(report.summary).toContain("Hire or retain employees");
    expect(report.actionRoadmap?.[0].callScript).toContain("hire or retain employees");
  });

  it("organizes programs across three goals and preserves custom context without scoring it", () => {
    const report = generateReportData(
      makeState({
        projectGoals: ["hiring", "equipment", "other"],
        projectType: "hiring",
        customGoal: "Open a shared commercial kitchen",
      }),
      [
        makeProgram({ id: "edge", name: "EDGE" }),
        makeProgram({ id: "sbaMicroloan", name: "SBA Microloan" }),
        makeProgram({ id: "sbif", name: "SBIF" }),
      ],
      { zones, zoneNames },
    );

    const bestMatches = report.sections.find(
      (section) => section.title === GOAL_MATCH_PROGRAMS_SECTION_TITLE,
    );
    expect(bestMatches?.items.map((item) => item.programId)).toEqual([
      "edge",
      "sbaMicroloan",
    ]);
    expect(report.metadata.projectGoals).toEqual(["hiring", "equipment", "other"]);
    expect(report.metadata.customGoal).toBe("Open a shared commercial kitchen");
    expect(report.executiveSummary?.projectGoalLabels).toEqual([
      "Hire or retain employees",
      "Buy equipment",
      "Open a shared commercial kitchen",
    ]);
    expect(JSON.stringify(report)).not.toContain('"score"');
  });

  it("never claims an open-text goal ordered or selected the programs", () => {
    const report = generateReportData(
      makeState({
        projectGoals: ["hiring", "equipment", "other"],
        projectType: "hiring",
        customGoal: "Open a shared commercial kitchen",
      }),
      [
        makeProgram({ id: "edge", name: "EDGE" }),
        makeProgram({ id: "sbaMicroloan", name: "SBA Microloan" }),
        makeProgram({ id: "sbif", name: "SBIF" }),
      ],
      { zones, zoneNames },
    );

    // projectGoalsFit has no GOAL_RULES entry for "other", so the kitchen goal
    // contributes nothing to ordering or to the goal-match filter.
    const whyTheseMatter = report.executiveSummary?.whyTheseMatter ?? "";
    expect(whyTheseMatter).toContain(
      "ordered across the selected goals: Hire or retain employees and Buy equipment",
    );
    expect(whyTheseMatter).toContain(
      "Open a shared commercial kitchen is recorded from your answers and does not affect that order",
    );
    expect(whyTheseMatter).not.toMatch(
      /ordered across[^.]*Open a shared commercial kitchen/,
    );

    const bestMatches = report.sections.find(
      (section) => section.title === GOAL_MATCH_PROGRAMS_SECTION_TITLE,
    );
    expect(bestMatches?.description).toContain(
      "may relate to the selected goals: Hire or retain employees and Buy equipment",
    );
    expect(bestMatches?.description).toContain(
      "Open a shared commercial kitchen is recorded from your answers but was not used to select these programs",
    );
    expect(bestMatches?.description).not.toMatch(
      /may relate to the selected goals:[^.]*Open a shared commercial kitchen/,
    );
  });

  it("says so plainly when the only goal is the unscored open-text one", () => {
    const report = generateReportData(
      makeState({
        projectGoals: ["other"],
        projectType: "other",
        customGoal: "Open a shared commercial kitchen",
      }),
      [makeProgram({ id: "edge", name: "EDGE" })],
      { zones, zoneNames },
    );

    expect(report.executiveSummary?.whyTheseMatter).toContain(
      "Program ordering does not use the selected goals",
    );
    expect(report.executiveSummary?.whyTheseMatter).not.toContain(
      "ordered across the selected goal",
    );
  });

  it("prioritizes Cook County discovery programs without treating them as address-confirmed", () => {
    const federalPrograms = Array.from({ length: 9 }, (_, index) => makeProgram({
      id: `federal-${index}`,
      name: `A Federal Discovery ${index}`,
      level: "Federal",
      zoneKey: "",
      eligibilityRules: [],
    }));
    const countyProgram = makeProgram({
      id: "smallBizSource",
      name: "Cook County Small Business Source",
      level: "County",
      zoneKey: "",
      eligibilityRules: [
        {
          criterion: "location",
          description: "Business in Cook County",
          verifiedBy: "manual",
          required: true,
        },
      ],
    });
    const suburbanOnlyCountyProgram = makeProgram({
      id: "cookBrownfield",
      name: "Cook County Brownfield Redevelopment Assistance",
      level: "County",
      zoneKey: "",
      eligibilityRules: [],
    });

    const report = generateReportData(
      makeState(),
      [...federalPrograms, countyProgram, suburbanOnlyCountyProgram],
      { zones: {}, zoneNames: {} },
    );

    const additionalSection = report.sections.find((s) => s.title === "Additional Programs to Explore");
    expect(report.summary).toContain("links 0 programs to this address");
    expect(report.sections.find((s) => s.title === CONFIRMED_PROGRAMS_SECTION_TITLE)).toBeUndefined();
    expect(additionalSection?.description).toContain("Cook County tools");
    expect(additionalSection?.items[0].programId).toBe("smallBizSource");
    expect(additionalSection?.items.map((item) => item.programId)).not.toContain("cookBrownfield");
  });

  it("prioritizes Cook County discovery programs in dev-feasibility reports", () => {
    const federalPrograms = Array.from({ length: 9 }, (_, index) => makeProgram({
      id: `federal-dev-${index}`,
      name: `A Federal Dev Discovery ${index}`,
      level: "Federal",
      zoneKey: "",
      eligibilityRules: [],
    }));
    const countyProgram = makeProgram({
      id: "cpace",
      name: "Cook County C-PACE (Clean Energy Financing)",
      level: "County",
      zoneKey: "",
      eligibilityRules: [
        {
          criterion: "location",
          description: "Commercial property in Cook County",
          verifiedBy: "manual",
          required: true,
        },
      ],
    });

    const report = generateReportData(
      makeState({
        reportType: "dev-feasibility",
        projectType: "rehab",
      }),
      [...federalPrograms, countyProgram],
      { zones: {}, zoneNames: {} },
    );

    const additionalSection = report.sections.find((s) => s.title === "Additional Programs to Explore");
    expect(additionalSection?.description).toContain("Cook County tools");
    expect(additionalSection?.items[0].programId).toBe("cpace");
  });

  it("renders neighborhood-specific support organizations when local support context is provided", () => {
    const report = generateReportData(
      makeState(),
      [makeProgram()],
      {
        zones,
        zoneNames,
        localBusinessSupport: {
          communityAreaNumber: "46",
          communityArea: "South Chicago",
          confidence: "High",
          sourceLabel: "Chicago Small Business Resource Map",
          sourceUrls: ["https://example.com/source"],
          organizations: [
            {
              name: "Southeast Chicago Chamber of Commerce",
              primaryType: "NBDC / Chamber",
              relationships: ["primary_access_point"],
              address: "8751 S Houston Ave, Chicago, IL 60617",
              phone: "773-721-1999",
              website: "https://southeastchgochamber.org",
              supportTypes: "Licensing; permits; corridor support",
              serviceGeography: "Southeast Chicago",
              currentStatus: "Active NBDC 2025/2026",
              sourceUrls: ["https://example.com/source"],
            },
          ],
        },
      },
    );

    const section = report.sections.find((s) => s.title === SUPPORT_ORGANIZATIONS_SECTION_TITLE);
    expect(section?.description).toContain(SUPPORT_ORGANIZATIONS_DESCRIPTION);
    expect(section?.description).toContain(SUPPORT_ORGANIZATIONS_CAPACITY_NOTE);
    expect(section?.items[0].label).toBe("Local Support in South Chicago");
    expect(section?.items[1].label).toBe("Southeast Chicago Chamber of Commerce");
    expect(section?.items[1].value).toContain("Primary local access point");
    expect(section?.items[1].detail).toContain("Licensing");
    expect(section?.items[1].detail).toContain("Published support services");
    expect(section?.items[1].detail).toContain("Current programs, intake capacity, and response times are not confirmed");
    expect(section?.items[1].detail).not.toContain("Status: Active");
    expect(report.dataSources?.map((source) => source.id)).toContain("localBusinessSupport");
  });

  it("renders useful support-network copy when a mapped organization has thin details", () => {
    const report = generateReportData(
      makeState(),
      [makeProgram()],
      {
        zones,
        zoneNames,
        localBusinessSupport: {
          communityAreaNumber: "40",
          communityArea: "Washington Park",
          confidence: "Medium",
          sourceLabel: "Chicago Small Business Resource Map",
          sourceUrls: ["https://example.com/source"],
          organizations: [
            {
              name: "Regional CBC Partner",
              relationships: ["cbc_hub"],
              sourceUrls: ["https://example.com/source"],
            },
          ],
        },
      },
    );

    const section = report.sections.find((s) => s.title === SUPPORT_ORGANIZATIONS_SECTION_TITLE);
    expect(section?.description).toContain(SUPPORT_ORGANIZATIONS_DESCRIPTION);
    expect(section?.items[0].detail).toContain("discovery list");
    expect(section?.items[1].detail).toContain("regional business navigation");
    expect(section?.items[1].detail).toContain("Website: not listed in the source records");
    expect(section?.items[1].detail).toContain("Washington Park");
  });

  it("does not present the API's own six-organization cap as the mapped total", () => {
    // Built exactly the way /api/local-business-support builds its payload:
    // merge citywide resources into the community-area entry, then
    // rankLocalBusinessSupport(pool, 6). That route is the only production
    // source of localBusinessSupport, and it publishes no pre-cap total — so
    // the engine cannot know how many organizations are mapped for the area,
    // and must not print the capped list length as if it were that number.
    const austinEntry = austinSupportEntry();
    expect(austinEntry.organizations.length).toBeGreaterThan(SUPPORT_ORGANIZATION_API_LIMIT);

    const context = austinSupportContextAsTheApiReturnsIt();
    expect(context.organizations).toHaveLength(SUPPORT_ORGANIZATION_API_LIMIT);

    const report = generateReportData(
      makeState(),
      [makeProgram()],
      { zones, zoneNames, localBusinessSupport: context },
    );

    const section = report.sections.find((s) => s.title === SUPPORT_ORGANIZATIONS_SECTION_TITLE);
    const summary = section?.items[0];
    expect(summary?.detail).not.toMatch(
      /\d+ local business-support organizations? (?:is|are) mapped for Austin/,
    );
    expect(summary?.detail).toContain(
      "This report lists 6 local business-support organizations for Austin",
    );
    expect(summary?.detail).toContain("there may be more");
    expect(summary?.value).toBe("6 organizations listed");
    // The mapped total is unknown here; publishing 6 as that total would be a
    // guess, so the field stays absent rather than echoing the list length.
    expect(report.communityAssets?.totalOrganizations).toBeUndefined();
    expect(report.communityAssets?.listingMayBeIncomplete).toBe(true);
  });

  it("reports the mapped organization total when a caller supplies the full mapped set", () => {
    // Austin maps 8 organizations; five of the 77 community areas exceed the
    // display cap. A caller that hands over the whole set (not the capped API
    // payload) gives the engine a total it can honestly print.
    const report = generateReportData(
      makeState(),
      [makeProgram()],
      {
        zones,
        zoneNames,
        localBusinessSupport: {
          communityAreaNumber: "25",
          communityArea: "Austin",
          confidence: "High",
          sourceLabel: "Chicago Small Business Resource Map",
          sourceUrls: ["https://example.com/source"],
          organizations: Array.from({ length: 8 }, (_, index) => ({
            name: `Austin Support Org ${index + 1}`,
            relationships: ["nbdc_2025" as const],
            sourceUrls: ["https://example.com/source"],
          })),
        },
      },
    );

    const section = report.sections.find((s) => s.title === SUPPORT_ORGANIZATIONS_SECTION_TITLE);
    expect(section?.items[0].detail).toContain("8 local business-support organizations are mapped for Austin");
    expect(section?.items[0].detail).toContain("This report lists the first 6.");
    expect(section?.items[0].value).toBe("6 of 8 organizations");
    // Six rows plus the summary row — the cap itself is unchanged.
    expect(section?.items).toHaveLength(7);
    expect(report.communityAssets?.totalOrganizations).toBe(8);
  });

  it("agrees in number when a single organization survives the support filters", () => {
    const report = generateReportData(
      makeState(),
      [makeProgram()],
      {
        zones,
        zoneNames,
        localBusinessSupport: {
          communityAreaNumber: "40",
          communityArea: "Washington Park",
          confidence: "Medium",
          sourceLabel: "Chicago Small Business Resource Map",
          sourceUrls: ["https://example.com/source"],
          organizations: [
            {
              name: "Only Mapped Partner",
              relationships: ["nbdc_2025" as const],
              sourceUrls: ["https://example.com/source"],
            },
          ],
        },
      },
    );

    const section = report.sections.find((s) => s.title === SUPPORT_ORGANIZATIONS_SECTION_TITLE);
    expect(section?.items[0].detail).toContain(
      "1 local business-support organization is mapped for Washington Park",
    );
    expect(section?.items[0].detail).not.toContain("organization are mapped");
  });

  it("leaves the count unqualified when nothing was dropped", () => {
    const report = generateReportData(
      makeState(),
      [makeProgram()],
      {
        zones,
        zoneNames,
        localBusinessSupport: {
          communityAreaNumber: "46",
          communityArea: "South Chicago",
          confidence: "High",
          sourceLabel: "Chicago Small Business Resource Map",
          sourceUrls: ["https://example.com/source"],
          organizations: Array.from({ length: 3 }, (_, index) => ({
            name: `South Chicago Support Org ${index + 1}`,
            relationships: ["nbdc_2025" as const],
            sourceUrls: ["https://example.com/source"],
          })),
        },
      },
    );

    const section = report.sections.find((s) => s.title === SUPPORT_ORGANIZATIONS_SECTION_TITLE);
    expect(section?.items[0].detail).toContain("3 local business-support organizations are mapped for South Chicago");
    expect(section?.items[0].detail).not.toContain("This report lists the first");
    expect(section?.items[0].value).toBe("3 organizations");
  });

  it("does not promise free advising or funding connections from the asset-directory fallback", () => {
    // No community area resolved: /api/assets returns every EDO/BSO row with no
    // address, project, or service-area filter applied anywhere.
    const report = generateReportData(
      makeState(),
      [makeProgram()],
      {
        zones,
        zoneNames,
        communityAssets: [
          { id: "edo-1", name: "An EDO", type: "EDO", address: "1 N Test St", lat: 41.8, lon: -87.6 },
          { id: "edo-2", name: "Another EDO", type: "EDO", address: "2 N Test St", lat: 41.8, lon: -87.6 },
          { id: "bso-1", name: "A BSO", type: "BSO", address: "3 N Test St", lat: 41.8, lon: -87.6 },
        ],
      },
    );

    const section = report.sections.find((s) => s.title === SUPPORT_ORGANIZATIONS_SECTION_TITLE);
    const narrative = section?.items[0].detail ?? "";
    expect(narrative).toContain("2 economic development organizations and 1 business support organization");
    expect(narrative).toContain("were not matched to this address, project type, or published service area");
    expect(narrative).not.toContain("serve your area");
    expect(narrative).not.toContain("free advising");
    expect(narrative).not.toContain("connections to funding");
    // The matched-selection sentence must not be borrowed by this branch.
    expect(section?.description).not.toContain(SUPPORT_ORGANIZATIONS_DESCRIPTION);
    expect(section?.description).toContain("not selected by published service area, project type, or support services");
    expect(section?.description).toContain(SUPPORT_ORGANIZATIONS_CAPACITY_NOTE);
  });

  it("renders legal support resources with reader-friendly role copy", () => {
    const report = generateReportData(
      makeState(),
      [makeProgram()],
      {
        zones,
        zoneNames,
        localBusinessSupport: {
          communityAreaNumber: "46",
          communityArea: "South Chicago",
          confidence: "High",
          sourceLabel: "Chicago Small Business Resource Map",
          sourceUrls: ["https://example.com/source"],
          organizations: [
            {
              name: "Legal Aid for New Entrepreneurs (LANE)",
              primaryType: "Legal Aid / Small Business Support",
              relationships: ["legal_support"],
              website: "https://lanechicago.org/legal_help",
              sourceUrls: ["https://www.lanechicago.org"],
            },
          ],
        },
      },
    );

    const section = report.sections.find((s) => s.title === SUPPORT_ORGANIZATIONS_SECTION_TITLE);
    expect(section?.items[1].label).toBe("Legal Aid for New Entrepreneurs (LANE)");
    expect(section?.items[1].value).toBe("Small business legal support");
    expect(section?.items[1].detail).toContain("small-business legal questions");
    expect(section?.items[1].url).toBe("https://lanechicago.org/legal_help");
  });

  it("propagates Phase 1 provenance fields onto report items", () => {
    const applicationPortals = [
      {
        type: "submittable" as const,
        label: "Apply on Submittable",
        url: "https://example.com/apply",
      },
    ];
    const verificationSteps = [
      {
        label: "Confirm certification",
        agency: "Test Agency",
        url: "https://example.com/verify",
        kind: "certification" as const,
      },
    ];
    const program = makeProgram({
      sourceUrl: "https://example.com/source",
      applicationPortals,
      verificationSteps,
    });

    const report = generateReportData(
      makeState(),
      [program],
      { zones, zoneNames },
    );

    const item = report.sections
      .find((s) => s.title === CONFIRMED_PROGRAMS_SECTION_TITLE)
      ?.items.find((i) => i.programId === "tif");

    expect(item?.sourceUrl).toBe(program.sourceUrl);
    expect(item?.applicationPortals).toEqual(applicationPortals);
    expect(item?.verificationSteps).toEqual(verificationSteps);
  });

  it("adds qualitative preparation cost signals to required documents", () => {
    const report = generateReportData(
      makeState({ projectGoals: ["rehab"], projectType: "rehab" }),
      [makeProgram({ requiredDocs: ["Phase I environmental assessment", "Building permits", "W-9"] })],
      { zones, zoneNames },
    );

    const required = report.sections.find((section) => section.title === "Required Documents");
    const copy = JSON.stringify(required);
    expect(copy).toContain("Phase I environmental assessment [$$$]");
    expect(copy).toContain("Building permits [$$]");
    expect(copy).toContain("W-9 [$]");
    expect(required?.description).toContain("document preparation, not program value");
  });

  it("does not list or count catalog guidance as a required document", () => {
    // Verbatim requiredDocs from the shipped catalog: ssa publishes two
    // statements that deny a document requirement, smallBizSource one.
    const report = generateReportData(
      makeState(),
      [
        makeProgram({
          requiredDocs: [
            "No application needed — benefits are automatic by location",
            "Contact your SSA delegate agency for any sub-program requirements",
            "Project budget",
          ],
        }),
      ],
      { zones, zoneNames },
    );

    const required = report.sections.find((section) => section.title === "Required Documents");
    const copy = JSON.stringify(required);
    expect(copy).not.toContain("No application needed");
    expect(copy).not.toContain("Contact your SSA delegate agency");
    expect(copy).toContain("Project budget");
    expect(required?.description).toContain("1 document");
  });

  it("omits the required-documents section when every published entry denies a requirement", () => {
    const report = generateReportData(
      makeState(),
      [
        makeProgram({
          requiredDocs: [
            "No application needed — benefits are automatic by location",
            "Contact your SSA delegate agency for any sub-program requirements",
          ],
        }),
      ],
      { zones, zoneNames },
    );

    expect(report.sections.find((section) => section.title === "Required Documents")).toBeUndefined();
    // Still published statements, so they stay in the program's own explanation
    // as public facts rather than disappearing from the report entirely.
    const item = report.sections
      .find((section) => section.title === CONFIRMED_PROGRAMS_SECTION_TITLE)
      ?.items.find((i) => i.programId === "tif");
    expect(item?.matchExplanation?.knownFromPublicData).toContain(
      "No application needed — benefits are automatic by location",
    );
    expect(item?.matchExplanation?.currentDocumentsToGather).toEqual([]);
  });

  it("strips catalog guidance from documents to gather in already-saved reports", () => {
    const guidance = "No formal documents required to get started";
    const generated = generateReportData(makeState(), [makeProgram()], { zones, zoneNames });
    // A report saved before the guidance/requirement split persisted these
    // strings under currentDocumentsToGather. Display and PDF both route saved
    // reports through normalizePublicReportForDisplay, so the split has to be
    // applied there too or the old copy keeps rendering.
    const saved = {
      ...generated,
      executiveSummary: {
        ...generated.executiveSummary,
        topPrograms: [
          {
            programId: "smallBizSource",
            name: "Small Business Source",
            explanation: {
              whyItAppears: ["Included in the saved report as a starting point for review."],
              knownFromPublicData: [],
              basedOnUserAnswers: [],
              stillToConfirm: [],
              currentDocumentsToGather: [guidance, "Business plan"],
              confirmWith: [],
            },
          },
        ],
      },
      sections: [
        {
          title: "Programs Mapped at This Address",
          description: "Saved section.",
          items: [
            {
              label: "Special Service Area (SSA)",
              programId: "ssa",
              value: "Review published terms",
              matchExplanation: {
                whyItAppears: ["Included in the saved report as a starting point for review."],
                knownFromPublicData: [],
                basedOnUserAnswers: [],
                stillToConfirm: [],
                currentDocumentsToGather: [
                  "No application needed — benefits are automatic by location",
                  "Contact your SSA delegate agency for any sub-program requirements",
                ],
                confirmWith: [],
              },
            },
          ],
        },
      ],
    } as unknown as GeneratedReport;

    const normalized = normalizePublicReportForDisplay(saved);

    const summaryExplanation = normalized.executiveSummary?.topPrograms[0].explanation;
    expect(summaryExplanation?.currentDocumentsToGather).toEqual(["Business plan"]);
    expect(summaryExplanation?.knownFromPublicData).toContain(guidance);

    const itemExplanation = normalized.sections[0].items[0].matchExplanation;
    expect(itemExplanation?.currentDocumentsToGather).toEqual([]);
    expect(itemExplanation?.knownFromPublicData).toEqual(
      expect.arrayContaining([
        "No application needed — benefits are automatic by location",
        "Contact your SSA delegate agency for any sub-program requirements",
      ]),
    );
  });

  it("does not aggregate possible incentive dollars from a project budget", () => {
    const report = generateReportData(
      makeState({
        budgetRange: "500k-2m",
        projectType: "rehab",
      }),
      [
        makeProgram({ id: "tif", zoneKey: "tif" }),
        makeProgram({ id: "sbif", name: "SBIF", zoneKey: "sbif" }),
        makeProgram({ id: "federalOZ", name: "Federal OZ", zoneKey: "federalOZ" }),
      ],
      { zones, zoneNames },
    );

    expect(report).not.toHaveProperty("benefitEstimates");
    expect(report.summary).not.toContain("total potential incentives");
    expect(report.summary).not.toContain("we estimate");
    expect(report.stackingAnalysis?.percentileLabel).toMatch(/^\d+ mapped zones?$/);
    expect(
      report.sections.some(
        (section) => section.title === "Incentive Zone Coverage & Program Interactions",
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(
      /stacking score|incentive density|top \d+%|strong fit|best matches|can stack|dramatically reduce|combined savings/i,
    );
  });

  it("adds neighborhood economic context with measured ZBP and license-continuity signals when provided", () => {
    const report = generateReportData(
      makeState(),
      [makeProgram()],
      {
        zones,
        zoneNames,
        census: {
          medianIncome: 58000,
          medianHomeValue: 210000,
          population: 4200,
          walkScore: 13,
          tractId: "17031000100",
        },
        neighborhoodEconomics: {
          geographyLabel: "ZIP 60619",
          businessContinuity: {
            baselineYear: 2020,
            comparisonYear: 2025,
            baselineActive: 1000,
            comparisonActive: 920,
            retained: 620,
            newSinceBaseline: 300,
            continuityRate: 0.62,
          },
          jobsPayroll: {
            baselineYear: 2020,
            comparisonYear: 2023,
            baselineEstablishments: 420,
            comparisonEstablishments: 455,
            baselineEmployment: 3200,
            comparisonEmployment: 3600,
            employmentGrowthRate: 0.125,
            baselineAnnualPayroll: 180000000,
            comparisonAnnualPayroll: 230000000,
            payrollGrowthRate: 0.278,
          },
          reinvestment: {
            permitCount: 80,
            reportedCost: 12500000,
            windowLabel: "the trailing 24 months",
          },
          property: {
            distinctOwners: 500,
            assessedValueChangeRate: 0.08,
          },
          anchors: [
            {
              name: "Regional Hospital",
              type: "Healthcare institution",
              totalScore: 88,
              impactTier: "High",
              rationale: "Major employer and destination",
              sourceUrls: ["https://example.org/hospital"],
            },
          ],
          tifFinance: {
            districtId: "T-087",
            districtName: "Fullerton/Milwaukee",
            reportYear: 2024,
            expirationYear: 2027,
            fundBalance: 63162041,
            propertyTaxIncrementCurrent: 21911518,
            amountDesignatedProjectCosts: 63011079,
            sourceLabel: "City of Chicago TIF Annual Report",
            sourceUrl: "https://data.cityofchicago.org/resource/qm7s-3ctt.json",
            caution: "District-level City annual report data. Not proof of funding availability.",
          },
        },
      },
    );

    const section = report.sections.find((s) => s.title === "Neighborhood Economic Context");
    expect(section).toBeDefined();
    expect(section?.items.find((i) => i.label === "Business Continuity")?.value).toContain("62%");
    expect(section?.items.find((i) => i.label === "Jobs & Payroll")?.detail).toContain("Census ZIP Business Patterns");
    expect(section?.items.find((i) => i.label === "Jobs & Payroll")?.value).toContain("jobs +13%");
    expect(section?.items.find((i) => i.label === "TIF District Funding Overview")?.value).toContain("Reported district fund balance");
    expect(section?.items.find((i) => i.label === "TIF District Funding Overview")?.detail).toContain("Not proof of funding availability");
    expect(section?.items.find((i) => i.label === "TIF District Funding Overview")?.detail).toContain("capture growth in property-tax revenue");
    expect(section?.items.find((i) => i.label === "Local Retail Demand")?.value).toContain("Modeled");
    const anchorSection = report.sections.find((s) => s.title === "Local Impact Anchors");
    expect(anchorSection?.items[0]).toMatchObject({
      label: "Regional Hospital",
      value: "Healthcare institution",
      detail: "Major employer and destination",
    });
    expect(JSON.stringify(anchorSection)).not.toMatch(/Score 88|High impact/i);
    expect(report.dataSources?.map((source) => source.id)).toContain("zbp");
    expect(report.dataSources?.map((source) => source.id)).toContain("buildingPermits");
    expect(report.dataSources?.map((source) => source.id)).toContain("assessorValues");
    expect(report.dataSources?.map((source) => source.id)).toContain("tifFinance");
  });

  it("generates corridor intelligence reports from corridor metrics", () => {
    const report = generateReportData(
      makeState({
        reportType: "corridor-intelligence",
        neighborhood: "60617",
        address: "",
        lat: null,
        lon: null,
      }),
      [makeProgram()],
      {
        corridorMetrics: {
          corridorType: "zip",
          corridorId: "60617",
          vacancyRate: 0.12,
          turnoverRate: 0.08,
          ownershipHHI: 0.23,
          localOwnershipShare: 0.41,
          permitCount: 19,
          incentiveCoverage: null,
          details: {
            vacancy: { vacantCount: 120, totalParcels: 1000 },
            turnover: { openings: 18, closures: 7 },
            ownershipConcentration: { distinctOwners: 720, topOwnerShare: 0.03, totalParcels: 1000 },
            ownershipOrigin: { localCount: 280, outsideCount: 400, unknownCount: 320 },
            permits: { totalReportedCost: 1500000, demolitionCount: 2 },
          },
        },
      },
    );

    expect(report.reportType).toBe("corridor-intelligence");
    expect(report.title).toContain("ZIP 60617");
    expect(report.metadata.corridorLabel).toBe("ZIP 60617");
    expect(report.subtitle).toContain("Market and resilience signals");
    expect(report.sections.find((section) => section.title === "Market Signal Summary")?.table?.rows.length).toBeGreaterThan(0);
    expect(report.sections.map((section) => section.title)).toContain("What The Signals Say");
    expect(report.sections.map((section) => section.title)).toContain("How To Read This");
    expect(report.sections.map((section) => section.title)).toContain("What A Funded Version Unlocks");
    expect(report.sections.map((section) => section.title)).not.toContain("Intervention Buckets");
    expect(report.recommendedActions).toEqual([]);
    expect(JSON.stringify(report)).not.toMatch(
      /healthScore|Market Signal Composite|Composite score|64\/100/i,
    );
  });

  it("flows restored polygon zone programs into report eligibility", () => {
    const hubzoneProgram = makeProgram({
      id: "hubzone",
      name: "SBA HUBZone Program",
      level: "Federal",
      zoneKey: "hubzone",
    });
    const energyCommunityProgram = makeProgram({
      id: "energyCommunityBonus",
      name: "IRA Energy Community Tax Credit Bonus",
      level: "Federal",
      zoneKey: "energyCommunities",
    });

    const report = generateReportData(
      makeState(),
      [hubzoneProgram, energyCommunityProgram],
      {
        zones: { hubzone: true, energyCommunities: true },
        zoneNames: {
          hubzone: "HUBZone Qualified Tract 17031010100",
          energyCommunities: "MSA Energy Community",
        },
      },
    );

    const eligibleSection = report.sections.find((s) => s.title === CONFIRMED_PROGRAMS_SECTION_TITLE);
    expect(eligibleSection?.items.map((item) => item.programId)).toEqual(
      expect.arrayContaining(["hubzone", "energyCommunityBonus"])
    );
    expect(report.summary).toContain("links 2 programs to this address");
  });
});
