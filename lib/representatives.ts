import { DOMParser, type Element as XmlElement } from "@xmldom/xmldom";
import { fetchWithRetry, getDistrictData } from "@/lib/district-lookup";
import { cached, roundCoord } from "@/lib/redis";
import type {
  DistrictData,
  DistrictOfficial,
  DistrictOfficials,
  DistrictSource,
} from "@/lib/types";

const REPRESENTATIVE_CACHE_TTL_SECONDS = 24 * 60 * 60;
const ROSTER_CACHE_TTL_SECONDS = 24 * 60 * 60;

const SOURCES = {
  wardOffices: {
    id: "city-ward-offices",
    label: "City of Chicago Ward Offices",
    url: "https://data.cityofchicago.org/Facilities-Geographic-Boundaries/Ward-Offices/htai-wnw4",
  },
  cookCountyBoundaries: {
    id: "cook-county-political-boundaries",
    label: "Cook County political boundary service",
    url: "https://gis.cookcountyil.gov/traditional/rest/services/politicalBoundary/MapServer",
  },
  cookCountyOfficials: {
    id: "cook-county-officials",
    label: "Cook County officials directory",
    url: "https://www.cookcountyil.gov/all-people",
  },
  houseClerk: {
    id: "us-house-clerk-member-data",
    label: "U.S. House Clerk member data",
    url: "https://clerk.house.gov/xml/lists/memberdata.xml",
  },
  ilgaHouse: {
    id: "ilga-house-members",
    label: "Illinois General Assembly House members",
    url: "https://www.ilga.gov/House/Members",
  },
  ilgaSenate: {
    id: "ilga-senate-members",
    label: "Illinois General Assembly Senate members",
    url: "https://www.ilga.gov/Senate/Members",
  },
} as const;

interface WardOfficeRow {
  ward?: string;
  alderman?: string;
  ward_phone?: string;
  email?: string;
  website?: { url?: string } | string;
}

interface HouseMember {
  district: string;
  name: string;
  party?: string | null;
  phone?: string | null;
  bioguideId?: string | null;
  sourcePublishedAt?: string | null;
}

interface IlgaMember {
  district: string;
  name: string;
  party?: string | null;
  url?: string | null;
}

interface CookCountyCommissioner {
  district: string;
  name: string;
  url: string;
}

type Roster<T> = Record<string, T>;

export function formatChicagoAldermanName(name: string): string {
  const [last, ...rest] = name.split(",");
  if (rest.length === 0) return name.trim();
  return `${rest.join(",").trim()} ${last.trim()}`.replace(/\s+/g, " ").trim();
}

function plainText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDistrict(value?: string | null): string | null {
  if (!value) return null;
  const match = String(value).match(/\d+/);
  if (!match) return null;
  return String(Number.parseInt(match[0], 10));
}

function websiteUrl(value: WardOfficeRow["website"]): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  return value.url;
}

async function getWardOfficeRoster(): Promise<Roster<WardOfficeRow>> {
  return cached("official-roster:ward-offices:v1", ROSTER_CACHE_TTL_SECONDS, async () => {
    const url =
      "https://data.cityofchicago.org/resource/htai-wnw4.json?$limit=500";
    const res = await fetchWithRetry(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Ward office lookup failed: ${res.status}`);
    const rows = (await res.json()) as WardOfficeRow[];
    const roster: Roster<WardOfficeRow> = {};
    for (const row of rows) {
      const ward = normalizeDistrict(row.ward);
      if (ward) roster[ward] = row;
    }
    return roster;
  });
}

function textContent(parent: XmlElement, tagName: string): string | null {
  const node = parent.getElementsByTagName(tagName)[0];
  return node?.textContent?.trim() || null;
}

export function parseHouseMembers(xml: string): Roster<HouseMember> {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const publishDate = doc.documentElement?.getAttribute("publish-date") ?? null;
  const members = Array.from(doc.getElementsByTagName("member"));
  const roster: Roster<HouseMember> = {};

  for (const member of members) {
    const stateDistrict = textContent(member, "statedistrict");
    const match = stateDistrict?.match(/^IL0?(\d+)$/);
    if (!match) continue;

    const memberInfo = member.getElementsByTagName("member-info")[0];
    if (!memberInfo) continue;

    const district = String(Number.parseInt(match[1], 10));
    roster[district] = {
      district,
      name: textContent(memberInfo, "official-name") || textContent(memberInfo, "namelist") || "",
      party: textContent(memberInfo, "party"),
      phone: textContent(memberInfo, "phone"),
      bioguideId: textContent(memberInfo, "bioguideID"),
      sourcePublishedAt: publishDate,
    };
  }

  return roster;
}

async function getHouseRoster(): Promise<Roster<HouseMember>> {
  return cached("official-roster:us-house-clerk:il:v1", ROSTER_CACHE_TTL_SECONDS, async () => {
    const res = await fetchWithRetry(SOURCES.houseClerk.url, {
      headers: { Accept: "application/xml,text/xml" },
    });
    if (!res.ok) throw new Error(`U.S. House member lookup failed: ${res.status}`);
    return parseHouseMembers(await res.text());
  });
}

export function parseIlgaMembers(html: string, chamber: "House" | "Senate"): Roster<IlgaMember> {
  const roster: Roster<IlgaMember> = {};
  const cardPattern =
    /<h2 class="h5 card-title"><a class="notranslate" href="([^"]+)">([\s\S]*?)<\/a>\s*\(([A-Z])\)<\/h2>[\s\S]*?<p class="card-text">([\s\S]*?)<\/p>/g;

  for (const match of html.matchAll(cardPattern)) {
    const district = normalizeDistrict(match[4]);
    if (!district || roster[district]) continue;

    const href = match[1].startsWith("http")
      ? match[1]
      : `https://www.ilga.gov${match[1]}`;

    roster[district] = {
      district,
      name: plainText(match[2]),
      party: match[3],
      url: href.includes(`/${chamber}/`) ? href : `https://www.ilga.gov/${chamber}/Members`,
    };
  }

  return roster;
}

export function parseCookCountyCommissioners(html: string): Roster<CookCountyCommissioner> {
  const roster: Roster<CookCountyCommissioner> = {};
  const commissionerPattern =
    /<div class="profile-name">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/div>\s*<div class="profile-info">[\s\S]*?<div class="profile-job-title">COUNTY BOARD COMMISSIONER,\s*(\d+)(?:ST|ND|RD|TH) DISTRICT<\/div>/g;

  for (const match of html.matchAll(commissionerPattern)) {
    const district = normalizeDistrict(match[3]);
    if (!district || roster[district]) continue;

    roster[district] = {
      district,
      name: plainText(match[2]),
      url: match[1].startsWith("http")
        ? match[1]
        : `https://www.cookcountyil.gov${match[1]}`,
    };
  }

  return roster;
}

async function getIlgaRoster(chamber: "House" | "Senate"): Promise<Roster<IlgaMember>> {
  const source = chamber === "House" ? SOURCES.ilgaHouse : SOURCES.ilgaSenate;
  return cached(`official-roster:ilga:${chamber.toLowerCase()}:v1`, ROSTER_CACHE_TTL_SECONDS, async () => {
    const res = await fetchWithRetry(source.url, {
      headers: { Accept: "text/html", "User-Agent": "ChicagoIncentiveExplorer/1.0" },
    });
    if (!res.ok) throw new Error(`ILGA ${chamber} lookup failed: ${res.status}`);
    return parseIlgaMembers(await res.text(), chamber);
  });
}

async function getCookCountyCommissionerRoster(): Promise<Roster<CookCountyCommissioner>> {
  return cached("official-roster:cook-county-commissioners:v1", ROSTER_CACHE_TTL_SECONDS, async () => {
    const res = await fetchWithRetry(SOURCES.cookCountyOfficials.url, {
      headers: { Accept: "text/html", "User-Agent": "ChicagoIncentiveExplorer/1.0" },
    });
    if (!res.ok) throw new Error(`Cook County officials lookup failed: ${res.status}`);
    return parseCookCountyCommissioners(await res.text());
  });
}

function sourceList(refreshedAt: string): DistrictSource[] {
  return Object.values(SOURCES).map((source) => ({ ...source, refreshedAt }));
}

function wardOfficial(ward: string | null, row: WardOfficeRow | undefined, refreshedAt: string): DistrictOfficial | null {
  if (!ward || !row?.alderman) return null;
  return {
    office: "Alderperson",
    district: ward,
    districtLabel: `Ward ${ward}`,
    name: formatChicagoAldermanName(row.alderman),
    phone: row.ward_phone || undefined,
    email: row.email || undefined,
    website: websiteUrl(row.website),
    sourceId: SOURCES.wardOffices.id,
    sourceLabel: SOURCES.wardOffices.label,
    sourceUrl: SOURCES.wardOffices.url,
    refreshedAt,
  };
}

function congressionalOfficial(district: string | null, row: HouseMember | undefined, refreshedAt: string): DistrictOfficial | null {
  if (!district || !row?.name) return null;
  return {
    office: "U.S. Representative",
    district,
    districtLabel: `IL-${district}`,
    name: row.name,
    party: row.party || undefined,
    phone: row.phone || undefined,
    website: row.bioguideId ? `https://clerk.house.gov/members/${row.bioguideId}` : SOURCES.houseClerk.url,
    sourceId: SOURCES.houseClerk.id,
    sourceLabel: row.sourcePublishedAt
      ? `${SOURCES.houseClerk.label} (${row.sourcePublishedAt})`
      : SOURCES.houseClerk.label,
    sourceUrl: SOURCES.houseClerk.url,
    refreshedAt,
  };
}

function commissionerOfficial(district: string | null, row: CookCountyCommissioner | undefined, refreshedAt: string): DistrictOfficial | null {
  if (!district || !row?.name) return null;
  return {
    office: "Cook County Commissioner",
    district,
    districtLabel: `District ${district}`,
    name: row.name,
    website: row.url,
    sourceId: SOURCES.cookCountyOfficials.id,
    sourceLabel: SOURCES.cookCountyOfficials.label,
    sourceUrl: SOURCES.cookCountyOfficials.url,
    refreshedAt,
  };
}

function ilgaOfficial(
  office: "State Representative" | "State Senator",
  district: string | null,
  row: IlgaMember | undefined,
  source: typeof SOURCES.ilgaHouse | typeof SOURCES.ilgaSenate,
  refreshedAt: string,
): DistrictOfficial | null {
  if (!district || !row?.name) return null;
  return {
    office,
    district,
    districtLabel: `District ${district}`,
    name: row.name,
    party: row.party || undefined,
    website: row.url || source.url,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceUrl: source.url,
    refreshedAt,
  };
}

export function buildOfficialsForDistricts(
  districts: DistrictData,
  rosters: {
    wardOffices?: Roster<WardOfficeRow>;
    commissioners?: Roster<CookCountyCommissioner>;
    house?: Roster<HouseMember>;
    ilgaHouse?: Roster<IlgaMember>;
    ilgaSenate?: Roster<IlgaMember>;
  },
  refreshedAt: string,
): DistrictOfficials {
  return {
    alderperson: wardOfficial(
      districts.ward,
      districts.ward ? rosters.wardOffices?.[districts.ward] : undefined,
      refreshedAt,
    ),
    commissioner: commissionerOfficial(
      districts.commissionerDistrict,
      districts.commissionerDistrict ? rosters.commissioners?.[districts.commissionerDistrict] : undefined,
      refreshedAt,
    ),
    congressionalRepresentative: congressionalOfficial(
      districts.congressionalDistrict,
      districts.congressionalDistrict ? rosters.house?.[districts.congressionalDistrict] : undefined,
      refreshedAt,
    ),
    stateRepresentative: ilgaOfficial(
      "State Representative",
      districts.stateHouseDistrict,
      districts.stateHouseDistrict ? rosters.ilgaHouse?.[districts.stateHouseDistrict] : undefined,
      SOURCES.ilgaHouse,
      refreshedAt,
    ),
    stateSenator: ilgaOfficial(
      "State Senator",
      districts.stateSenateDistrict,
      districts.stateSenateDistrict ? rosters.ilgaSenate?.[districts.stateSenateDistrict] : undefined,
      SOURCES.ilgaSenate,
      refreshedAt,
    ),
  };
}

export async function getRepresentativeData(lat: number, lon: number): Promise<DistrictData> {
  const cacheKey = `representatives:v2:${roundCoord(lat)}:${roundCoord(lon)}`;

  return cached<DistrictData>(cacheKey, REPRESENTATIVE_CACHE_TTL_SECONDS, async () => {
    const districts = await getDistrictData(lat, lon);
    const refreshedAt = new Date().toISOString();

    const [wardOffices, commissioners, house, ilgaHouse, ilgaSenate] = await Promise.allSettled([
      getWardOfficeRoster(),
      getCookCountyCommissionerRoster(),
      getHouseRoster(),
      getIlgaRoster("House"),
      getIlgaRoster("Senate"),
    ]);

    const officials = buildOfficialsForDistricts(
      districts,
      {
        wardOffices: wardOffices.status === "fulfilled" ? wardOffices.value : undefined,
        commissioners: commissioners.status === "fulfilled" ? commissioners.value : undefined,
        house: house.status === "fulfilled" ? house.value : undefined,
        ilgaHouse: ilgaHouse.status === "fulfilled" ? ilgaHouse.value : undefined,
        ilgaSenate: ilgaSenate.status === "fulfilled" ? ilgaSenate.value : undefined,
      },
      refreshedAt,
    );

    return {
      ...districts,
      officials,
      sources: sourceList(refreshedAt),
      refreshedAt,
    };
  });
}
