import { socrataHeaders } from "@/lib/socrata";
import {
  chicagoCalendarDay,
  normalizeChicagoSourceCalendarDate,
} from "@/lib/vacancy-evidence";

export const VACANCY_LICENSE_POLICY_VERSION = "issued-exact-address-v4" as const;
export const VACANCY_LICENSE_ADDRESS_CAP = 500;
export const VACANCY_LICENSE_BATCH_SIZE = 50;
export const VACANCY_LICENSE_MAX_BATCHES = 10;
export const VACANCY_LICENSE_BATCH_RESULT_LIMIT = 500;
export const VACANCY_LICENSE_MAX_SOURCE_CALLS = 40;
export const VACANCY_LICENSE_MATCH_LIMIT_PER_PROPERTY = 5;

const LICENSE_SOURCE_PATH =
  "https://data.cityofchicago.org/resource/r5kz-chrr.json" as const;

export type VacancyLicenseScreeningStatus =
  | "not_requested"
  | "available"
  | "partial"
  | "unavailable";

export type VacancyLicenseCheckState =
  | "match"
  | "no_match"
  | "not_checked_address"
  | "not_checked_cap"
  | "unavailable";

export interface CurrentLicenseConflictMatch {
  name: string;
  description: string;
  status: "AAI";
  expirationDate: string;
}

export interface VacancyLicenseScreeningMetadata {
  policyVersion: typeof VACANCY_LICENSE_POLICY_VERSION;
  sourcePath: typeof LICENSE_SOURCE_PATH;
  status: VacancyLicenseScreeningStatus;
  checkedAt: string | null;
  candidateCount: number;
  checkedCount: number;
  matchedPropertyCount: number;
  capped: boolean;
  addressCap: typeof VACANCY_LICENSE_ADDRESS_CAP;
  sourceCallCount: number;
  successfulBatches: number;
  failedBatches: number;
  malformedRowCount: number;
  partialReasons: Array<
    "address_cap" | "source_batch_failure" | "malformed_source_rows"
  >;
  caveats: string[];
}

interface RawLicenseRow {
  address?: unknown;
  doing_business_as_name?: unknown;
  license_description?: unknown;
  license_status?: unknown;
  expiration_date?: unknown;
}

export interface VacancyLicenseScreeningOptions {
  fetchImpl?: typeof fetch;
  checkedAt?: string | Date;
  timeoutMs?: number;
}

const LICENSE_CAVEATS = [
  "An issued, unexpired BACP license at the exact published address is a conflict signal, not proof that the property is occupied.",
  "No exact-address match is not evidence that a property is unoccupied; address formatting and change-of-location records can limit matching.",
];

export function notRequestedLicenseScreening(): VacancyLicenseScreeningMetadata {
  return {
    policyVersion: VACANCY_LICENSE_POLICY_VERSION,
    sourcePath: LICENSE_SOURCE_PATH,
    status: "not_requested",
    checkedAt: null,
    candidateCount: 0,
    checkedCount: 0,
    matchedPropertyCount: 0,
    capped: false,
    addressCap: VACANCY_LICENSE_ADDRESS_CAP,
    sourceCallCount: 0,
    successfulBatches: 0,
    failedBatches: 0,
    malformedRowCount: 0,
    partialReasons: [],
    caveats: [...LICENSE_CAVEATS],
  };
}

function canonicalAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ").toUpperCase();
  return normalized.length >= 5 ? normalized : null;
}

function sodaLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function isoTimestamp(value: string | Date | undefined): string {
  const parsed = value === undefined ? new Date() : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("License screening checkedAt must be valid");
  }
  return parsed.toISOString();
}

function dateOnly(value: unknown): string | null {
  return normalizeChicagoSourceCalendarDate(value)?.slice(0, 10) ?? null;
}

function buildBatchUrl(addresses: readonly string[], checkedAt: string): string {
  const queryDay = chicagoCalendarDay(checkedAt);
  const addressList = addresses.map((address) => `'${sodaLiteral(address)}'`).join(",");
  const params = new URLSearchParams({
    "$select":
      "address,doing_business_as_name,license_description,license_status,expiration_date",
    "$where":
      `address in(${addressList}) AND license_status='AAI' ` +
      `AND expiration_date>'${queryDay}T00:00:00'`,
    "$order": "address ASC,expiration_date DESC",
    "$limit": String(VACANCY_LICENSE_BATCH_RESULT_LIMIT),
  });
  return `${LICENSE_SOURCE_PATH}?${params.toString()}`;
}

async function fetchLicenseBatch(
  addresses: readonly string[],
  checkedAt: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ rows: RawLicenseRow[]; saturated: boolean }> {
  const response = await fetchImpl(buildBatchUrl(addresses, checkedAt), {
    headers: socrataHeaders(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`BACP license source returned HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error("BACP license source returned malformed JSON");
  return {
    rows: body as RawLicenseRow[],
    saturated: body.length >= VACANCY_LICENSE_BATCH_RESULT_LIMIT,
  };
}

type LicenseBatchResult = {
  addresses: string[];
  rows: RawLicenseRow[];
  error: unknown | null;
};

async function fetchLicenseBatchAdaptive(
  addresses: string[],
  checkedAt: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  reserveSourceCall: () => boolean,
): Promise<LicenseBatchResult[]> {
  if (!reserveSourceCall()) {
    return [{
      addresses,
      rows: [],
      error: new Error("BACP license screening source-call budget exhausted"),
    }];
  }
  try {
    const result = await fetchLicenseBatch(addresses, checkedAt, fetchImpl, timeoutMs);
    if (!result.saturated) {
      return [{ addresses, rows: result.rows, error: null }];
    }
    if (addresses.length === 1) {
      return [{
        addresses,
        rows: [],
        error: new Error("BACP license address reached its result limit"),
      }];
    }
    const midpoint = Math.ceil(addresses.length / 2);
    const nested = await Promise.all([
      fetchLicenseBatchAdaptive(
        addresses.slice(0, midpoint),
        checkedAt,
        fetchImpl,
        timeoutMs,
        reserveSourceCall,
      ),
      fetchLicenseBatchAdaptive(
        addresses.slice(midpoint),
        checkedAt,
        fetchImpl,
        timeoutMs,
        reserveSourceCall,
      ),
    ]);
    return nested.flat();
  } catch (error) {
    return [{ addresses, rows: [], error }];
  }
}

/**
 * Screen an area result with ten root batches and a hard 40-call ceiling. A
 * saturated root batch is split until its address groups are complete or the
 * source-call budget is exhausted. Matching is intentionally exact after
 * trim/case/whitespace normalization; there is no abbreviation or fuzzy
 * matching. Every source failure is carried into per-record and aggregate state
 * so it cannot render as a clean zero.
 */
export async function screenVacancyLicenseConflicts(
  collection: GeoJSON.FeatureCollection,
  options: VacancyLicenseScreeningOptions = {},
): Promise<{
  features: GeoJSON.Feature[];
  meta: VacancyLicenseScreeningMetadata;
}> {
  const checkedAt = isoTimestamp(options.checkedAt);
  const fetchImpl = options.fetchImpl ?? fetch;
  const addressToIndexes = new Map<string, number[]>();

  collection.features.forEach((feature, index) => {
    const address = canonicalAddress(feature.properties?.address);
    if (!address) return;
    const indexes = addressToIndexes.get(address) ?? [];
    indexes.push(index);
    addressToIndexes.set(address, indexes);
  });

  const allAddresses = Array.from(addressToIndexes.keys()).sort();
  const selectedAddresses = allAddresses.slice(0, VACANCY_LICENSE_ADDRESS_CAP);
  const selectedSet = new Set(selectedAddresses);
  const batches: string[][] = [];
  for (let i = 0; i < selectedAddresses.length; i += VACANCY_LICENSE_BATCH_SIZE) {
    batches.push(selectedAddresses.slice(i, i + VACANCY_LICENSE_BATCH_SIZE));
  }
  if (batches.length > VACANCY_LICENSE_MAX_BATCHES) {
    throw new Error("License screening batch invariant exceeded");
  }

  let sourceCallCount = 0;
  const reserveSourceCall = () => {
    if (sourceCallCount >= VACANCY_LICENSE_MAX_SOURCE_CALLS) return false;
    sourceCallCount += 1;
    return true;
  };
  const rootBatchResults = await Promise.all(
    batches.map(async (addresses) => ({
      addresses,
      leaves: await fetchLicenseBatchAdaptive(
          addresses,
          checkedAt,
          fetchImpl,
          options.timeoutMs ?? 8_000,
          reserveSourceCall,
        ),
    })),
  );
  const batchResults = rootBatchResults.flatMap((result) => result.leaves);

  const successfulAddresses = new Set<string>();
  const failedAddresses = new Set<string>();
  const matchesByAddress = new Map<string, CurrentLicenseConflictMatch[]>();
  let malformedRowCount = 0;

  for (const result of batchResults) {
    if (result.error) {
      result.addresses.forEach((address) => failedAddresses.add(address));
      continue;
    }
    result.addresses.forEach((address) => successfulAddresses.add(address));
    for (const row of result.rows) {
      const address = canonicalAddress(row.address);
      const status = row.license_status;
      const expirationDate = dateOnly(row.expiration_date);
      if (
        !address ||
        !selectedSet.has(address) ||
        status !== "AAI" ||
        !expirationDate ||
        expirationDate <= chicagoCalendarDay(checkedAt)
      ) {
        malformedRowCount += 1;
        continue;
      }
      const name =
        typeof row.doing_business_as_name === "string"
          ? row.doing_business_as_name.trim()
          : "";
      if (!name) {
        malformedRowCount += 1;
        continue;
      }
      const current = matchesByAddress.get(address) ?? [];
      if (
        current.length < VACANCY_LICENSE_MATCH_LIMIT_PER_PROPERTY &&
        !current.some(
          (match) =>
            match.name === name &&
            match.expirationDate === expirationDate,
        )
      ) {
        current.push({
          name,
          description:
            typeof row.license_description === "string"
              ? row.license_description.trim()
              : "",
          status: "AAI",
          expirationDate,
        });
        matchesByAddress.set(address, current);
      }
    }
  }

  const features = collection.features.map((feature) => {
    const address = canonicalAddress(feature.properties?.address);
    let licenseCheckState: VacancyLicenseCheckState;
    let currentLicenseMatches: CurrentLicenseConflictMatch[] = [];
    if (!address) {
      licenseCheckState = "not_checked_address";
    } else if (!selectedSet.has(address)) {
      licenseCheckState = "not_checked_cap";
    } else if (failedAddresses.has(address)) {
      licenseCheckState = "unavailable";
    } else {
      currentLicenseMatches = matchesByAddress.get(address) ?? [];
      licenseCheckState = currentLicenseMatches.length > 0 ? "match" : "no_match";
    }
    return {
      ...feature,
      properties: {
        ...(feature.properties ?? {}),
        licenseCheckState,
        currentLicenseMatches,
        licenseCheckedAt: selectedSet.has(address ?? "") ? checkedAt : null,
      },
    };
  });

  // These remain root address-group coverage counts. Adaptive leaf calls are
  // reported separately so consumers never confuse fan-out with coverage.
  const successfulBatches = rootBatchResults.filter((result) =>
    result.leaves.every((leaf) => !leaf.error),
  ).length;
  const failedBatches = rootBatchResults.length - successfulBatches;
  const capped = allAddresses.length > selectedAddresses.length;
  const partialReasons: VacancyLicenseScreeningMetadata["partialReasons"] = [];
  if (capped) partialReasons.push("address_cap");
  if (failedBatches > 0) partialReasons.push("source_batch_failure");
  if (malformedRowCount > 0) partialReasons.push("malformed_source_rows");
  const hasIncompleteCoverage = partialReasons.length > 0;
  const status: VacancyLicenseScreeningStatus =
    batches.length === 0
      ? "available"
      : successfulAddresses.size === 0
        ? "unavailable"
        : hasIncompleteCoverage
          ? "partial"
          : "available";

  return {
    features,
    meta: {
      policyVersion: VACANCY_LICENSE_POLICY_VERSION,
      sourcePath: LICENSE_SOURCE_PATH,
      status,
      checkedAt,
      candidateCount: allAddresses.length,
      checkedCount: successfulAddresses.size,
      matchedPropertyCount: features.filter(
        (feature) => feature.properties?.licenseCheckState === "match",
      ).length,
      capped,
      addressCap: VACANCY_LICENSE_ADDRESS_CAP,
      sourceCallCount,
      successfulBatches,
      failedBatches,
      malformedRowCount,
      partialReasons,
      caveats: [
        ...LICENSE_CAVEATS,
        ...(malformedRowCount > 0
          ? [
              `${malformedRowCount} malformed or policy-ineligible source row${malformedRowCount === 1 ? " was" : "s were"} ignored; screening coverage is partial.`,
            ]
          : []),
      ],
    },
  };
}
