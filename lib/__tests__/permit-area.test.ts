import { describe, expect, it, vi } from "vitest";
import {
  fetchPermitArea,
  formatPermitAreaDate,
  formatPermitAreaCoverageLabel,
  PERMIT_AREA_DATA_WINDOW_LABEL,
  PERMIT_AREA_PORTAL_URL,
  PERMIT_AREA_SOURCE_LABEL,
  PERMIT_AREA_SOURCE_URL,
  parsePermitAreaResult,
  permitAreaRequestPath,
  type PermitAreaResult,
} from "@/lib/permit-area";
import { buildDrawnAreaCsv } from "@/lib/polygon-investment";

const POLYGON: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-87.65, 41.87],
      [-87.6, 41.87],
      [-87.6, 41.9],
      [-87.65, 41.9],
      [-87.65, 41.87],
    ],
  ],
};

const MONTHLY_BREAKDOWN = Array.from({ length: 36 }, (_, index) => {
  const month = new Date(Date.UTC(2023, 8 + index, 1)).toISOString().slice(0, 7);
  return { month, count: month === "2026-08" ? 1 : 0 };
});

const RESULT: PermitAreaResult = {
  status: "ready",
  source: {
    label: PERMIT_AREA_SOURCE_LABEL,
    url: PERMIT_AREA_SOURCE_URL,
    portalUrl: PERMIT_AREA_PORTAL_URL,
  },
  dataWindow: PERMIT_AREA_DATA_WINDOW_LABEL,
  sourceRefresh: {
    asOf: "2026-08-04T18:22:00.000Z",
    asOfBasis: "latest_queried_row_fetched_at",
  },
  locatedRecordsOnly: true,
  totalFilings: 1,
  distinctAddresses: 1,
  issueDateSpan: { first: "2026-08-04", latest: "2026-08-04" },
  rollingPulse: {
    asOf: "2026-08-04",
    current: {
      start: "2025-08-05",
      end: "2026-08-04",
      filings: 1,
      distinctAddresses: 1,
      addressedFilings: 1,
    },
    previous: {
      start: "2024-08-05",
      end: "2025-08-04",
      filings: 0,
      distinctAddresses: 0,
      addressedFilings: 0,
    },
    changeCount: 1,
    changePercent: null,
  },
  monthlyBreakdown: MONTHLY_BREAKDOWN,
  topAddresses: [{ address: "123 W TEST ST", count: 1 }],
  typeBreakdown: [
    {
      key: null,
      label: "Not recorded",
      sourceValue: "Not recorded",
      color: "#64748B",
      count: 1,
    },
  ],
  yearBreakdown: [{ year: 2026, count: 1 }],
  statusBreakdown: [{ status: "Issued", count: 1 }],
  records: [
    {
      permitId: "100012345",
      permitTypeKey: null,
      permitTypeLabel: "Not recorded",
      rawPermitType: null,
      address: "123 W TEST ST",
      issueDate: "2026-08-04",
      permitStatus: "Issued",
      permitMilestone: null,
      workType: null,
      workDescription: null,
    },
  ],
  recordsReturned: 1,
  recordsTruncated: false,
};

const ZERO_RESULT: PermitAreaResult = {
  ...RESULT,
  sourceRefresh: { asOf: null, asOfBasis: null },
  totalFilings: 0,
  distinctAddresses: 0,
  issueDateSpan: null,
  rollingPulse: {
    asOf: null,
    current: {
      start: null,
      end: null,
      filings: 0,
      distinctAddresses: 0,
      addressedFilings: 0,
    },
    previous: {
      start: null,
      end: null,
      filings: 0,
      distinctAddresses: 0,
      addressedFilings: 0,
    },
    changeCount: 0,
    changePercent: null,
  },
  monthlyBreakdown: [],
  topAddresses: [],
  typeBreakdown: [],
  yearBreakdown: [],
  statusBreakdown: [],
  records: [],
  recordsReturned: 0,
  recordsTruncated: false,
};

describe("permit area client", () => {
  it("builds a reproducible polygon request", () => {
    const path = permitAreaRequestPath(POLYGON);
    const url = new URL(path, "http://localhost");
    expect(url.pathname).toBe("/api/permit-area");
    expect(JSON.parse(url.searchParams.get("polygon") ?? "")).toEqual(POLYGON);
  });

  it("returns a ready source-backed result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(RESULT), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(fetchPermitArea(POLYGON, { fetchImpl })).resolves.toEqual(RESULT);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("accepts an honest zero result", () => {
    expect(parsePermitAreaResult(ZERO_RESULT)).toEqual(ZERO_RESULT);
  });

  it("accepts positive filings when nullable source freshness is unavailable", () => {
    const result = {
      ...RESULT,
      sourceRefresh: { asOf: null, asOfBasis: null },
    } satisfies PermitAreaResult;

    expect(parsePermitAreaResult(result)).toEqual(result);
  });

  it("accepts reconciled current and preceding rolling periods", () => {
    const result = {
      ...RESULT,
      totalFilings: 2,
      issueDateSpan: { first: "2025-08-04", latest: "2026-08-04" },
      rollingPulse: {
        ...RESULT.rollingPulse,
        previous: {
          start: "2024-08-05",
          end: "2025-08-04",
          filings: 1,
          distinctAddresses: 1,
          addressedFilings: 1,
        },
        changeCount: 0,
        changePercent: 0,
      },
      monthlyBreakdown: MONTHLY_BREAKDOWN.map((item) =>
        item.month === "2025-08" ? { ...item, count: 1 } : item,
      ),
      typeBreakdown: [{ ...RESULT.typeBreakdown[0], count: 2 }],
      yearBreakdown: [
        { year: 2026, count: 1 },
        { year: 2025, count: 1 },
      ],
      statusBreakdown: [{ status: "Issued", count: 2 }],
      recordsTruncated: true,
    } satisfies PermitAreaResult;

    expect(parsePermitAreaResult(result)).toEqual(result);
  });

  it.each([
    ["source label", { ...RESULT, source: { ...RESULT.source, label: "City permits" } }],
    ["source URL", { ...RESULT, source: { ...RESULT.source, url: "https://example.com" } }],
    [
      "verification portal",
      { ...RESULT, source: { ...RESULT.source, portalUrl: "https://example.com" } },
    ],
    ["data window", { ...RESULT, dataWindow: "Since 2016" }],
    [
      "noncanonical freshness timestamp",
      {
        ...RESULT,
        sourceRefresh: {
          asOf: "2026-08-04 18:22:00+00",
          asOfBasis: "latest_queried_row_fetched_at",
        },
      },
    ],
  ])("rejects altered permit provenance in %s", (_field, altered) => {
    expect(parsePermitAreaResult(altered)).toBeNull();
  });

  it("treats HTTP and malformed readiness responses as lookup failures", async () => {
    const unavailable = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    await expect(fetchPermitArea(POLYGON, { fetchImpl: unavailable })).rejects.toThrow("HTTP 503");

    const malformed = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "partial" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(fetchPermitArea(POLYGON, { fetchImpl: malformed })).rejects.toThrow("not ready");

    const missingFreshness = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...RESULT, sourceRefresh: undefined }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(
      fetchPermitArea(POLYGON, { fetchImpl: missingFreshness }),
    ).rejects.toThrow("not ready");
  });

  it.each([
    ["source", { ...RESULT, source: { ...RESULT.source, url: 42 } }],
    ["source refresh", { ...RESULT, sourceRefresh: { asOf: [], asOfBasis: null } }],
    ["data window", { ...RESULT, dataWindow: null }],
    ["located-only flag", { ...RESULT, locatedRecordsOnly: false }],
    ["numeric summary", { ...RESULT, totalFilings: "1" }],
    ["issue-date span", { ...RESULT, issueDateSpan: { first: "2026-08-04" } }],
    ["rolling pulse", { ...RESULT, rollingPulse: { ...RESULT.rollingPulse, asOf: 20260804 } }],
    ["monthly breakdown", { ...RESULT, monthlyBreakdown: [{ month: "August", count: 1 }] }],
    ["top addresses", { ...RESULT, topAddresses: [{ address: "", count: 1 }] }],
    [
      "type breakdown",
      {
        ...RESULT,
        typeBreakdown: [
          {
            key: "not-a-map-type",
            label: "Invalid",
            sourceValue: null,
            color: "#000000",
            count: 1,
          },
        ],
      },
    ],
    ["year breakdown", { ...RESULT, yearBreakdown: [{ year: "2026", count: 1 }] }],
    ["status breakdown", { ...RESULT, statusBreakdown: [{ status: null, count: 1 }] }],
    [
      "recent records",
      {
        ...RESULT,
        records: [
          {
            permitId: "100012345",
            permitTypeKey: null,
            permitTypeLabel: "Not recorded",
            rawPermitType: null,
            address: 123,
            issueDate: null,
            permitStatus: null,
            permitMilestone: null,
            workType: null,
            workDescription: null,
          },
        ],
        recordsReturned: 1,
      },
    ],
    ["returned-record count", { ...RESULT, recordsReturned: 0 }],
    ["truncation flag", { ...RESULT, recordsTruncated: "yes" }],
  ])("rejects a ready payload with malformed %s", async (_field, malformed) => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(malformed), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(parsePermitAreaResult(malformed)).toBeNull();
    await expect(fetchPermitArea(POLYGON, { fetchImpl })).rejects.toThrow("not ready");
  });

  it.each([
    ["more addresses than filings", { ...RESULT, distinctAddresses: 2 }],
    [
      "a record when the total is zero",
      {
        ...ZERO_RESULT,
        records: RESULT.records,
        recordsReturned: 1,
        recordsTruncated: false,
      },
    ],
    [
      "a type-breakdown sum that differs from the total",
      { ...RESULT, typeBreakdown: [{ ...RESULT.typeBreakdown[0], count: 0 }] },
    ],
    [
      "a year-breakdown sum that differs from the total",
      { ...RESULT, yearBreakdown: [{ year: 2026, count: 2 }] },
    ],
    ["a status-breakdown sum that differs from the total", { ...RESULT, statusBreakdown: [] }],
    [
      "a rolling anchor that differs from the latest filing",
      { ...RESULT, rollingPulse: { ...RESULT.rollingPulse, asOf: "2026-08-03" } },
    ],
    [
      "an incorrectly ordered rolling period",
      {
        ...RESULT,
        rollingPulse: {
          ...RESULT.rollingPulse,
          current: { ...RESULT.rollingPulse.current, start: "2025-08-04" },
        },
      },
    ],
    [
      "an unreconciled rolling change",
      { ...RESULT, rollingPulse: { ...RESULT.rollingPulse, changeCount: 0 } },
    ],
    [
      "a percentage when the prior filing count is zero",
      { ...RESULT, rollingPulse: { ...RESULT.rollingPulse, changePercent: 100 } },
    ],
    [
      "more rolling distinct addresses than addressed filings",
      {
        ...RESULT,
        rollingPulse: {
          ...RESULT.rollingPulse,
          current: {
            ...RESULT.rollingPulse.current,
            distinctAddresses: 2,
          },
        },
      },
    ],
    [
      "a top-address count above the addressed-filings denominator",
      { ...RESULT, topAddresses: [{ address: "123 W TEST ST", count: 2 }] },
    ],
    [
      "duplicate punctuation-insensitive top addresses",
      {
        ...RESULT,
        rollingPulse: {
          ...RESULT.rollingPulse,
          current: {
            ...RESULT.rollingPulse.current,
            filings: 2,
            addressedFilings: 2,
          },
          changeCount: 2,
        },
        totalFilings: 2,
        distinctAddresses: 1,
        monthlyBreakdown: MONTHLY_BREAKDOWN.map((item) =>
          item.month === "2026-08" ? { ...item, count: 2 } : item,
        ),
        topAddresses: [
          { address: "123 W. TEST ST", count: 1 },
          { address: "123 W TEST ST", count: 1 },
        ],
        typeBreakdown: [{ ...RESULT.typeBreakdown[0], count: 2 }],
        yearBreakdown: [{ year: 2026, count: 2 }],
        statusBreakdown: [{ status: "Issued", count: 2 }],
        recordsTruncated: true,
      },
    ],
    [
      "a monthly series that is not oldest to newest",
      { ...RESULT, monthlyBreakdown: [...MONTHLY_BREAKDOWN].reverse() },
    ],
    [
      "a nonempty pulse attached to a zero result",
      { ...ZERO_RESULT, rollingPulse: RESULT.rollingPulse },
    ],
    [
      "duplicate recent permit IDs",
      {
        ...RESULT,
        totalFilings: 2,
        distinctAddresses: 1,
        typeBreakdown: [{ ...RESULT.typeBreakdown[0], count: 2 }],
        yearBreakdown: [{ year: 2026, count: 2 }],
        statusBreakdown: [{ status: "Issued", count: 2 }],
        records: [RESULT.records[0], { ...RESULT.records[0], permitId: " 100012345 " }],
        recordsReturned: 2,
        recordsTruncated: false,
      },
    ],
    ["a truncated flag when all records were returned", { ...RESULT, recordsTruncated: true }],
    [
      "an unreported truncation",
      {
        ...RESULT,
        totalFilings: 2,
        distinctAddresses: 1,
        typeBreakdown: [{ ...RESULT.typeBreakdown[0], count: 2 }],
        yearBreakdown: [{ year: 2026, count: 2 }],
        statusBreakdown: [{ status: "Issued", count: 2 }],
        recordsTruncated: false,
      },
    ],
    ["a missing issue-date span for nonzero filings", { ...RESULT, issueDateSpan: null }],
    [
      "a nonempty issue-date span for zero filings",
      { ...ZERO_RESULT, issueDateSpan: RESULT.issueDateSpan },
    ],
    [
      "non-null freshness for zero filings",
      { ...ZERO_RESULT, sourceRefresh: RESULT.sourceRefresh },
    ],
    [
      "freshness without its basis",
      { ...RESULT, sourceRefresh: { asOf: RESULT.sourceRefresh.asOf, asOfBasis: null } },
    ],
    [
      "a freshness basis without a timestamp",
      {
        ...RESULT,
        sourceRefresh: { asOf: null, asOfBasis: "latest_queried_row_fetched_at" },
      },
    ],
    [
      "an invalid freshness timestamp",
      {
        ...RESULT,
        sourceRefresh: {
          asOf: "not-a-timestamp",
          asOfBasis: "latest_queried_row_fetched_at",
        },
      },
    ],
    [
      "a reversed issue-date span",
      { ...RESULT, issueDateSpan: { first: "2026-08-05", latest: "2026-08-04" } },
    ],
    [
      "an invalid issue-date span",
      { ...RESULT, issueDateSpan: { first: "2026-02-30", latest: "2026-08-04" } },
    ],
    [
      "an issue-date span before the published data window",
      {
        ...RESULT,
        issueDateSpan: { first: "2014-12-31", latest: "2014-12-31" },
        yearBreakdown: [{ year: 2014, count: 1 }],
        records: [{ ...RESULT.records[0], issueDate: "2014-12-31" }],
      },
    ],
    [
      "a year breakdown outside the issue-date span",
      { ...RESULT, yearBreakdown: [{ year: 2025, count: 1 }] },
    ],
    [
      "a recent record after the latest aggregate date",
      {
        ...RESULT,
        records: [{ ...RESULT.records[0], issueDate: "2026-08-05" }],
      },
    ],
    [
      "a recent record without its source-backed issue date",
      {
        ...RESULT,
        records: [{ ...RESULT.records[0], issueDate: null }],
      },
    ],
    [
      "a zero-count aggregate bucket",
      {
        ...RESULT,
        typeBreakdown: [
          RESULT.typeBreakdown[0],
          {
            key: null,
            label: "Unused",
            sourceValue: "Unused",
            color: "#64748B",
            count: 0,
          },
        ],
      },
    ],
    [
      "duplicate aggregate buckets",
      {
        ...RESULT,
        totalFilings: 2,
        typeBreakdown: [
          RESULT.typeBreakdown[0],
          { ...RESULT.typeBreakdown[0], count: 1 },
        ],
        yearBreakdown: [{ year: 2026, count: 2 }],
        statusBreakdown: [{ status: "Issued", count: 2 }],
        recordsTruncated: true,
      },
    ],
    [
      "more recent records than the API limit",
      {
        ...RESULT,
        totalFilings: 251,
        distinctAddresses: 1,
        typeBreakdown: [{ ...RESULT.typeBreakdown[0], count: 251 }],
        yearBreakdown: [{ year: 2026, count: 251 }],
        statusBreakdown: [{ status: "Issued", count: 251 }],
        records: Array.from({ length: 251 }, (_, index) => ({
          ...RESULT.records[0],
          permitId: `permit-${index}`,
        })),
        recordsReturned: 251,
        recordsTruncated: false,
      },
    ],
  ])("rejects a ready payload with contradictory %s", (_case, contradictory) => {
    expect(parsePermitAreaResult(contradictory)).toBeNull();
  });

  it("keeps a malformed ready payload unavailable to downstream CSV", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...RESULT, typeBreakdown: [{}] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    let permitArea: PermitAreaResult | null = null;
    let permitLoadFailed = false;

    try {
      permitArea = await fetchPermitArea(POLYGON, { fetchImpl });
    } catch {
      permitLoadFailed = true;
    }

    const csv = buildDrawnAreaCsv({
      areaName: "Malformed permit area",
      vacancyFeatures: [],
      permitArea,
      permitLoadFailed,
      investment: null,
    });
    expect(permitArea).toBeNull();
    expect(permitLoadFailed).toBe(true);
    expect(csv).toContain('"Coverage status","Unavailable"');
    expect(csv).toContain("lookup failure, not evidence that the area has no permits");
    expect(csv).not.toContain('"Section","Permit filing summary"');
  });

  it("relays cancellation and applies a bounded request timeout", async () => {
    const abortingFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
    );
    const caller = new AbortController();
    const cancelled = fetchPermitArea(POLYGON, {
      fetchImpl: abortingFetch as typeof fetch,
      signal: caller.signal,
      timeoutMs: 1_000,
    });
    caller.abort(new DOMException("Caller stopped", "AbortError"));
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });

    const timedOut = fetchPermitArea(POLYGON, {
      fetchImpl: abortingFetch as typeof fetch,
      timeoutMs: 5,
    });
    await expect(timedOut).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("formats source dates without changing unparseable values", () => {
    expect(formatPermitAreaDate("2026-08-04")).toBe("Aug 4, 2026");
    expect(formatPermitAreaDate("source value")).toBe("source value");
    expect(formatPermitAreaDate(null)).toBe("Not recorded");
    expect(formatPermitAreaCoverageLabel(RESULT)).toBe(
      "Since 2015; database updated Aug 4, 2026",
    );
    expect(
      formatPermitAreaCoverageLabel({
        ...RESULT,
        sourceRefresh: { asOf: null, asOfBasis: null },
      }),
    ).toBe("Since 2015; database update date unavailable");
  });
});

describe("analysis picker copy honesty (audit F1, 2026-08-24)", () => {
  it("the permit-activity picker card never claims construction value — the API pins reported_cost OUT of the query", async () => {
    const { REPORT_TYPE_OPTIONS } = await import("@/lib/report-wizard-config");
    const card = REPORT_TYPE_OPTIONS.find((option) => option.id === "permit-activity");
    expect(card).toBeDefined();
    const copy = `${card?.title ?? ""} ${card?.subtitle ?? ""} ${card?.bestFor ?? ""}`.toLowerCase();
    expect(copy).not.toContain("construction value");
    expect(copy).not.toContain("reported cost");
  });
});
