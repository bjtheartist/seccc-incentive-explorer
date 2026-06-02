export interface LiveZipAcsContext {
  zip: string;
  population: number | null;
  households: number | null;
  medianHouseholdIncome: number | null;
  employedResidents: number | null;
  residentSpendingPowerProxy: number | null;
  sourceLabel: string;
}

interface FetchLiveZipAcsOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const ACS_2024_ZCTA_SOURCE = "2024 ACS 5-year ZCTA API (live Census)";

export function parseCensusEstimate(value: string | undefined): number | null {
  if (!value || value.startsWith("-")) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function residentSpendingPowerProxy(
  households: number | null,
  medianHouseholdIncome: number | null
): number | null {
  if (households == null || medianHouseholdIncome == null) return null;
  return households * medianHouseholdIncome;
}

export async function fetchLiveZipAcsContext(
  zip: string,
  options: FetchLiveZipAcsOptions = {}
): Promise<LiveZipAcsContext | null> {
  const apiKey = options.apiKey ?? process.env.CENSUS_API_KEY;
  if (!apiKey || !/^\d{5}$/.test(zip)) return null;

  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL("https://api.census.gov/data/2024/acs/acs5");
  url.searchParams.set("get", "NAME,B01003_001E,B11001_001E,B19013_001E,B23025_004E");
  url.searchParams.set("for", `zip code tabulation area:${zip}`);
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
    });
    if (!res.ok) return null;

    const rows = (await res.json()) as string[][];
    const [header, row] = rows;
    if (!header || !row) return null;

    const idx = Object.fromEntries(header.map((key, i) => [key, i]));
    const households = parseCensusEstimate(row[idx.B11001_001E]);
    const medianHouseholdIncome = parseCensusEstimate(row[idx.B19013_001E]);

    return {
      zip: row[idx["zip code tabulation area"]] || zip,
      population: parseCensusEstimate(row[idx.B01003_001E]),
      households,
      medianHouseholdIncome,
      employedResidents: parseCensusEstimate(row[idx.B23025_004E]),
      residentSpendingPowerProxy: residentSpendingPowerProxy(
        households,
        medianHouseholdIncome
      ),
      sourceLabel: ACS_2024_ZCTA_SOURCE,
    };
  } catch {
    return null;
  }
}
