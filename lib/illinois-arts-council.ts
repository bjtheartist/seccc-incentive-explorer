export const IAC_SOURCE_PAGE =
  "https://arts.illinois.gov/about-iac/iac-arts-impact/annual-report/grant-summaries.html";
export const IAC_SOURCE_DATA_URL =
  "https://arts.illinois.gov/content/soi/arts/en/about-iac/iac-arts-impact/annual-report/grant-summaries/jcr:content/responsivegrid/container/container/data_table_copy.datatablejson.json";
export const IAC_SOURCE_VERSION = "FY2026 Q1";
export const IAC_FISCAL_YEAR = 2026;

export const IAC_SOURCE_EXPECTATIONS = {
  sourceRows: 1_413,
  awardRows: 1_408,
  awardDollars: 16_211_010,
  summaryRows: 5,
  chicagoRows: 670,
  chicagoAwardDollars: 9_162_720,
} as const;

export const IAC_PROGRAMS = [
  "CREATIVE ACCELERATOR",
  "GENERAL OPERATING SUPPORT",
  "REGIONAL ARTS PARTNER",
  "YOUTH EMPLOYMENT",
] as const;

export interface IllinoisArtsCouncilAward {
  /** Snapshot-local key generated from the official table row number. */
  recordId: string;
  sourceRow: number;
  program: string;
  applicantName: string;
  grantAmount: number;
  city: string;
  region: string;
  fiscalYear: number;
  sourceVersion: string;
  sourcePageUrl: string;
  sourceDataUrl: string;
  sourceCheckedAt: string;
}

interface SourceSummaryRow {
  program: string;
  label: string;
  amount: number;
}

export interface ParsedIllinoisArtsCouncilSource {
  awards: IllinoisArtsCouncilAward[];
  chicagoAwards: IllinoisArtsCouncilAward[];
  summaries: SourceSummaryRow[];
}

function parseUsd(raw: string, label: string): number {
  const value = raw.trim();
  if (!/^\$[\d,]+$/.test(value)) {
    throw new Error(`${label} has an invalid grant amount: ${raw}`);
  }
  const parsed = Number(value.slice(1).replace(/,/g, ""));
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} has an unsafe grant amount: ${raw}`);
  }
  return parsed;
}

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function assertStringRow(row: unknown, index: number): string[] {
  if (
    !Array.isArray(row) ||
    row.length !== 5 ||
    row.some((cell) => typeof cell !== "string")
  ) {
    throw new Error(`Illinois Arts Council source row ${index + 1} is not a five-string row.`);
  }
  return row as string[];
}

/** Parse and reconcile the official FY2026 Q1 JSON table. */
export function parseIllinoisArtsCouncilSource(
  text: string,
  sourceCheckedAt: string,
): ParsedIllinoisArtsCouncilSource {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Illinois Arts Council source is not valid JSON.");
  }
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) {
    throw new Error("Illinois Arts Council source does not contain a data array.");
  }
  if (data.length !== IAC_SOURCE_EXPECTATIONS.sourceRows) {
    throw new Error(
      `Illinois Arts Council source-row contract failed: expected ${IAC_SOURCE_EXPECTATIONS.sourceRows}, got ${data.length}.`,
    );
  }

  const awards: IllinoisArtsCouncilAward[] = [];
  const summaries: SourceSummaryRow[] = [];
  for (let index = 0; index < data.length; index++) {
    const [programRaw, applicantRaw, amountRaw, cityRaw, regionRaw] =
      assertStringRow(data[index], index);
    const program = programRaw.trim();
    const applicantName = applicantRaw.trim();
    const amount = parseUsd(amountRaw, `Illinois Arts Council row ${index + 1}`);
    const city = cityRaw.trim();
    const region = regionRaw.trim();

    if (applicantName === "Total" || program === "GRANT TOTAL") {
      summaries.push({ program, label: applicantName, amount });
      continue;
    }
    if (!(IAC_PROGRAMS as readonly string[]).includes(program)) {
      throw new Error(`Illinois Arts Council row ${index + 1} has an unknown program: ${program}`);
    }
    if (!applicantName || !city || !region || amount <= 0) {
      throw new Error(`Illinois Arts Council row ${index + 1} is missing required award data.`);
    }

    awards.push({
      recordId: `iac-fy26-q1-row-${String(index + 1).padStart(4, "0")}`,
      sourceRow: index + 1,
      program,
      applicantName,
      grantAmount: amount,
      city,
      region,
      fiscalYear: IAC_FISCAL_YEAR,
      sourceVersion: IAC_SOURCE_VERSION,
      sourcePageUrl: IAC_SOURCE_PAGE,
      sourceDataUrl: IAC_SOURCE_DATA_URL,
      sourceCheckedAt,
    });
  }

  const awardDollars = awards.reduce((sum, award) => sum + award.grantAmount, 0);
  if (
    awards.length !== IAC_SOURCE_EXPECTATIONS.awardRows ||
    summaries.length !== IAC_SOURCE_EXPECTATIONS.summaryRows ||
    awardDollars !== IAC_SOURCE_EXPECTATIONS.awardDollars
  ) {
    throw new Error(
      `Illinois Arts Council award contract failed: got ${awards.length} awards / ` +
        `${summaries.length} summaries / $${awardDollars}.`,
    );
  }

  const grantTotal = summaries.find((row) => row.program === "GRANT TOTAL");
  if (grantTotal?.amount !== awardDollars) {
    throw new Error("Illinois Arts Council grant-total row does not reconcile to award rows.");
  }
  for (const program of IAC_PROGRAMS) {
    const reported = summaries.find((row) => row.program === program);
    const calculated = awards
      .filter((award) => award.program === program)
      .reduce((sum, award) => sum + award.grantAmount, 0);
    if (reported?.amount !== calculated) {
      throw new Error(`Illinois Arts Council ${program} summary does not reconcile.`);
    }
  }

  const chicagoAwards = awards.filter(
    (award) => award.city.toLowerCase() === "chicago",
  );
  const chicagoDollars = chicagoAwards.reduce(
    (sum, award) => sum + award.grantAmount,
    0,
  );
  if (
    chicagoAwards.length !== IAC_SOURCE_EXPECTATIONS.chicagoRows ||
    chicagoDollars !== IAC_SOURCE_EXPECTATIONS.chicagoAwardDollars
  ) {
    throw new Error(
      `Illinois Arts Council Chicago contract failed: got ${chicagoAwards.length} awards / $${chicagoDollars}.`,
    );
  }

  return { awards, chicagoAwards, summaries };
}

export function serializeIllinoisArtsCouncilAwards(
  awards: readonly IllinoisArtsCouncilAward[],
): string {
  const header = [
    "record_id",
    "source_row",
    "program",
    "applicant_name",
    "grant_amount_usd",
    "city",
    "region",
    "fiscal_year",
    "source_version",
    "source_page_url",
    "source_data_url",
    "source_checked_at",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const award of awards) {
    lines.push(
      [
        award.recordId,
        award.sourceRow,
        award.program,
        award.applicantName,
        award.grantAmount,
        award.city,
        award.region,
        award.fiscalYear,
        award.sourceVersion,
        award.sourcePageUrl,
        award.sourceDataUrl,
        award.sourceCheckedAt,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Validate the committed Chicago-only CSV after the generic CSV reader. */
export function parseCuratedIllinoisArtsCouncilAwards(
  rows: readonly Record<string, string>[],
): IllinoisArtsCouncilAward[] {
  const ids = new Set<string>();
  const awards = rows.map((row, index) => {
    const recordId = row.record_id?.trim();
    const sourceRow = Number(row.source_row);
    const grantAmount = Number(row.grant_amount_usd);
    const fiscalYear = Number(row.fiscal_year);
    if (!recordId || ids.has(recordId)) {
      throw new Error(`Curated Illinois Arts Council row ${index + 1} has a missing or duplicate record_id.`);
    }
    if (
      !Number.isSafeInteger(sourceRow) ||
      !Number.isSafeInteger(grantAmount) ||
      grantAmount <= 0 ||
      fiscalYear !== IAC_FISCAL_YEAR ||
      row.city?.trim().toLowerCase() !== "chicago" ||
      !(IAC_PROGRAMS as readonly string[]).includes(row.program?.trim()) ||
      !row.applicant_name?.trim() ||
      !row.region?.trim() ||
      row.source_version !== IAC_SOURCE_VERSION ||
      row.source_page_url !== IAC_SOURCE_PAGE ||
      row.source_data_url !== IAC_SOURCE_DATA_URL ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.source_checked_at ?? "")
    ) {
      throw new Error(`Curated Illinois Arts Council row ${index + 1} violates the source contract.`);
    }
    ids.add(recordId);
    return {
      recordId,
      sourceRow,
      program: row.program.trim(),
      applicantName: row.applicant_name.trim(),
      grantAmount,
      city: row.city.trim(),
      region: row.region.trim(),
      fiscalYear,
      sourceVersion: row.source_version,
      sourcePageUrl: row.source_page_url,
      sourceDataUrl: row.source_data_url,
      sourceCheckedAt: row.source_checked_at,
    };
  });

  const dollars = awards.reduce((sum, award) => sum + award.grantAmount, 0);
  if (
    awards.length !== IAC_SOURCE_EXPECTATIONS.chicagoRows ||
    dollars !== IAC_SOURCE_EXPECTATIONS.chicagoAwardDollars
  ) {
    throw new Error(
      `Curated Illinois Arts Council contract failed: got ${awards.length} awards / $${dollars}.`,
    );
  }
  return awards;
}
