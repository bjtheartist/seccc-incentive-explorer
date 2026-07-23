/**
 * Opportunity Areas — the PUBLIC, place-led derivation behind the Vacant Sites
 * section (GPT-5.6 IA consult, adopted "option A"). An Opportunity Area is "a
 * short list of nearby properties that may work together — not a list of owners
 * and not a declaration that the land is available." Its detail page is a
 * Revitalization File.
 *
 * CLIENT-SAFE and PURE (no fs, no DB): derived AT RENDER TIME from the committed
 * vacancy-index edition (the existing loader) — no new export, no new data file.
 * Unit-tested without a DB.
 *
 * ── Non-negotiable rails honored here ──
 *  • Anonymization: areas are grouped by GEOGRAPHY ONLY (the existing proximity
 *    clusters). Ownership appears solely as a CATEGORY mix (public labels). No
 *    owner name or mailing address is ever read or emitted — those fields are
 *    not even present on the edition data this module consumes.
 *  • Discovery, not compliance: every scenario is conditional ("could support
 *    further exploration"); never "ideal for", "development-ready", or
 *    "available".
 *  • Fixed templates over real fields: all prose is composed from the templates
 *    below, keyed on real counts/zoning — no free-form generated claims.
 *  • Nulls stay honest: unknown lot size is counted, never coerced to 0.
 *
 * ── Naming source (verified against the committed data, deliberate choice) ──
 * The edition's proximity clusters carry a `corridorName`, but it is NOT unique
 * across the kept clusters — in 60617 four clusters share "South Chicago CCSA
 * Corridor" and three share "Commercial Avenue", so using the corridor as an
 * area IDENTITY would misrepresent several distinct geographies as one place and
 * fail the "which area am I in?" test. The honest, always-available, place-led
 * source is therefore the MODAL STREET among the area's member addresses
 * ("Buffalo Avenue area"), made unique with a geographic compass qualifier when
 * two areas resolve to the same street ("91st Street area (north)"). The
 * corridor is preserved as CONTEXT (`corridorContext`), never as the identity.
 * The fallback "Area N near {neighborhood}" is used only when an area has no
 * member address to read a street from. `namingSource` records which path won.
 */

import type { OwnerType } from "./owner-classify";
import { OWNER_TYPE_ORDER, normalizeOwnerType } from "./owner-classify";
import { zoningGloss } from "./vacancy-zoning";
import { PUBLIC_OWNER_TYPE_LABELS } from "./vacancy-public-labels";
import type {
  VacancyBbox,
  VacancyCluster,
  VacancyIndexEdition,
  VacancyPropertyType,
  VacancySitePoint,
} from "./vacancy-index";

/** The minimum member count for a proximity cluster to surface as a public
 * Opportunity Area (mirrors the clustering minimum). */
export const MIN_AREA_SITES = 5;

/** How many Opportunity-Area cards the index page shows before collapsing the
 * remainder into a "+ N more areas shown on the property map" line. */
export const AREA_DISPLAY_CAP = 12;

/** Which source produced an area's display name. */
export type OpportunityAreaNamingSource = "corridor" | "street" | "fallback";

/** Zoning family buckets used by the scenario/standout templates. */
export type ZoningFamily = "commercial" | "residential" | "industrial" | "downtown" | "other";

/** One property inside an Opportunity Area (from a mapped sitePoint). Owner
 * TYPE only — never a name. */
export interface OpportunityAreaMember {
  address: string | null;
  propertyType: VacancyPropertyType;
  ownerType: OwnerType;
  squareFeet: number | null;
  zoningClass: string | null;
  incentiveCount: number;
  pin: string | null;
  saleYear: number | null;
  violation: boolean;
  lat: number;
  lon: number;
}

/** One ownership-CATEGORY share (public label + honest count). */
export interface OwnershipCategoryShare {
  ownerType: OwnerType;
  label: string;
  count: number;
}

/** A fully derived, public Opportunity Area (a Revitalization File's data). */
export interface OpportunityArea {
  clusterId: number;
  name: string;
  namingSource: OpportunityAreaNamingSource;
  /** The area's named-corridor context, or null. Shown as a subtitle, never as
   * the identity. */
  corridorContext: string | null;
  neighborhood: string;
  /** Authoritative site count (cluster.count, computed over the full universe). */
  siteCount: number;
  /** Members actually reachable in the (capped) mapped sitePoints — may be fewer
   * than siteCount; every per-member figure below is honest about this floor. */
  memberCount: number;
  members: OpportunityAreaMember[];
  /** Sum of KNOWN member lot sizes (sq ft); nulls excluded and counted. */
  combinedKnownSqft: number;
  sqftUnknownCount: number;
  vacantLandCount: number;
  vacantBuildingCount: number;
  taxSaleCount: number;
  violationCount: number;
  /** Members intersecting ≥1 incentive geography. */
  incentiveSiteCount: number;
  dominantZoningClass: string | null;
  zoningGlossText: string | null;
  zoningFamilies: ZoningFamily[];
  /** Ownership CATEGORY mix over the FULL cluster (honest zeros), public labels. */
  ownershipMix: OwnershipCategoryShare[];
  /** 1–3 conditional reuse scenarios (fixed templates). */
  scenarios: string[];
  /** ≤2 "why it stands out" reasons (fixed templates over real fields). */
  standoutReasons: string[];
  /** ≥1 "needs checking" cautions (real flags only). */
  needsChecking: string[];
  bbox: VacancyBbox;
  centroid: { lat: number; lon: number };
}

// ── Street-name derivation ───────────────────────────────────────────────────

const DIRECTIONALS = new Set(["N", "S", "E", "W"]);
const STREET_TYPE_WORDS: Record<string, string> = {
  AVE: "Avenue",
  AV: "Avenue",
  ST: "Street",
  PL: "Place",
  DR: "Drive",
  BLVD: "Boulevard",
  RD: "Road",
  CT: "Court",
  TER: "Terrace",
  TERR: "Terrace",
  PKWY: "Parkway",
  LN: "Lane",
  SQ: "Square",
  HWY: "Highway",
  WAY: "Way",
  CIR: "Circle",
};

/** Title-case one street token, preserving ordinals (91ST → 91st). */
function titleToken(word: string): string {
  const w = word.toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/**
 * Normalize a raw address to a plain-language STREET name (drops the house
 * number, leading directional, and expands the street-type suffix), or null
 * when there is nothing usable. Examples:
 *   "8558 S GREEN BAY AVE" -> "Green Bay Avenue"
 *   "8131 S EXCHANGE AVE"  -> "Exchange Avenue"
 *   "E 91ST ST"            -> "91st Street"
 */
export function streetNameFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const trimmed = address.trim();
  if (!trimmed) return null;
  // Drop a leading house number (and any range like "123-125").
  const noNumber = trimmed.replace(/^\s*\d+[A-Za-z]?(?:\s*-\s*\d+[A-Za-z]?)?\s+/, "");
  let tokens = noNumber.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  // Drop a leading directional (N/S/E/W).
  if (DIRECTIONALS.has(tokens[0].toUpperCase())) tokens = tokens.slice(1);
  if (tokens.length === 0) return null;
  // Expand a trailing street-type word; drop a trailing directional (e.g. "AVE N").
  const lastUpper = tokens[tokens.length - 1].toUpperCase();
  let typeWord: string | null = null;
  if (DIRECTIONALS.has(lastUpper) && tokens.length > 1) tokens = tokens.slice(0, -1);
  const finalUpper = tokens[tokens.length - 1]?.toUpperCase();
  if (finalUpper && STREET_TYPE_WORDS[finalUpper]) {
    typeWord = STREET_TYPE_WORDS[finalUpper];
    tokens = tokens.slice(0, -1);
  }
  if (tokens.length === 0) return null;
  const namePart = tokens.map(titleToken).join(" ");
  return typeWord ? `${namePart} ${typeWord}` : namePart;
}

/** The single most-common street among members (ties broken alphabetically for
 * determinism), or null when no member carries a usable address. */
export function modalStreet(members: readonly OpportunityAreaMember[]): string | null {
  const freq = new Map<string, number>();
  for (const m of members) {
    const street = streetNameFromAddress(m.address);
    if (street) freq.set(street, (freq.get(street) ?? 0) + 1);
  }
  if (freq.size === 0) return null;
  let best: string | null = null;
  let bestCount = -1;
  for (const [street, count] of freq) {
    if (count > bestCount || (count === bestCount && best != null && street < best)) {
      best = street;
      bestCount = count;
    }
  }
  return best;
}

// ── Zoning families ──────────────────────────────────────────────────────────

/** Map one Chicago zoning code to its family (longest prefixes first). */
export function zoningFamilyOf(zoningClass: string | null): ZoningFamily | null {
  if (!zoningClass) return null;
  const u = zoningClass.trim().toUpperCase();
  if (!u) return null;
  if (u.startsWith("PMD")) return "industrial";
  if (u.startsWith("POS")) return "other";
  if (u.startsWith("PD")) return "other";
  if (u.startsWith("D")) return "downtown";
  if (u.startsWith("R")) return "residential";
  if (u.startsWith("B")) return "commercial";
  if (u.startsWith("C")) return "commercial";
  if (u.startsWith("M")) return "industrial";
  return "other";
}

// ── Approximate size ─────────────────────────────────────────────────────────

/** Round a square-foot figure to two significant figures for "about N sq ft"
 * copy (6234 -> 6200, 18450 -> 18000). Never rounds a genuine 0 up. */
export function approxSqft(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const digits = Math.floor(Math.log10(value));
  const round = Math.pow(10, Math.max(0, digits - 1));
  return Math.round(value / round) * round;
}

// ── Template prose (fixed) ───────────────────────────────────────────────────

/** 1–3 conditional reuse scenarios, chosen by real zoning / size / count. */
export function scenariosForArea(area: {
  siteCount: number;
  combinedKnownSqft: number;
  zoningFamilies: readonly ZoningFamily[];
}): string[] {
  const fams = new Set(area.zoningFamilies);
  const out: string[] = [];
  if (fams.has("commercial") && area.siteCount >= 3) {
    out.push("Storefront or mixed-use infill could support further exploration.");
  }
  if (fams.has("residential")) {
    out.push("Side-lot or community reuse could support further exploration.");
  }
  if (area.siteCount >= 8 && area.combinedKnownSqft >= 20000) {
    out.push("A larger assembled site could support further exploration.");
  }
  if (fams.has("industrial")) {
    out.push("Light-manufacturing or industrial reuse could support further exploration.");
  }
  if (out.length === 0) {
    out.push("These nearby sites could support further exploration of reuse options.");
  }
  return out.slice(0, 3);
}

/** ≤2 "why it stands out" reasons (fixed priority), real fields only. */
export function standoutReasonsForArea(area: {
  siteCount: number;
  memberCount: number;
  combinedKnownSqft: number;
  incentiveSiteCount: number;
  ownershipMix: readonly OwnershipCategoryShare[];
  zoningFamilies: readonly ZoningFamily[];
}): string[] {
  const reasons: string[] = [];
  const fams = new Set(area.zoningFamilies);
  const publicCount = area.ownershipMix.find((s) => s.ownerType === "city_public")?.count ?? 0;
  if (fams.has("commercial")) reasons.push("Commercial zoning present");
  if (area.incentiveSiteCount > 0) {
    reasons.push(
      `${area.incentiveSiteCount} of ${area.memberCount} mapped sites intersect an incentive geography`,
    );
  }
  if (publicCount > 0 && publicCount >= area.siteCount * 0.4) {
    reasons.push("Substantial public land in the group");
  }
  if (area.combinedKnownSqft >= 20000) {
    reasons.push(`About ${approxSqft(area.combinedKnownSqft).toLocaleString("en-US")} sq ft of known lot area`);
  }
  if (area.siteCount >= 10) reasons.push(`${area.siteCount} nearby vacant sites`);
  return reasons.slice(0, 2);
}

/** ≥1 "needs checking" cautions — real flags only (ownership mix incl. the
 * not-yet-classified share, distress presence, zoning gaps). Never fabricates
 * an environmental or condition claim. */
export function needsCheckingForArea(area: {
  siteCount: number;
  memberCount: number;
  taxSaleCount: number;
  violationCount: number;
  zoningUnknownCount: number;
  ownershipMix: readonly OwnershipCategoryShare[];
}): string[] {
  const needs: string[] = [];
  const notClassified = area.ownershipMix.find((s) => s.ownerType === "unknown")?.count ?? 0;
  const distinctCategories = area.ownershipMix.filter((s) => s.count > 0).length;
  if (notClassified > 0) {
    needs.push(`${notClassified} of ${area.siteCount} sites are not yet classified by ownership type`);
  }
  if (distinctCategories >= 2) {
    needs.push("Mixed ownership types across the group");
  }
  if (area.taxSaleCount > 0 || area.violationCount > 0) {
    needs.push("Some sites carry tax-sale or violation history — verify current status");
  }
  if (area.zoningUnknownCount > 0) {
    needs.push(`Zoning is not recorded for ${area.zoningUnknownCount} mapped sites — confirm allowable uses`);
  }
  if (needs.length === 0) {
    needs.push("Ownership, condition, and zoning must be verified for each site");
  }
  return needs;
}

/** The three sequenced, actor-labeled next steps (fixed copy). */
export const AREA_NEXT_STEPS: ReadonlyArray<{ actor: string; step: string }> = [
  { actor: "Corridor partner", step: "Confirm present site conditions and community priorities." },
  { actor: "Project team", step: "Review official parcel and deed records for each site." },
  { actor: "Development partner", step: "Test zoning and financial feasibility." },
];

/**
 * The prominent mapped-detail coverage disclosure (defect C): whenever an
 * area's derived per-member facts (size, zoning, per-site rows, incentive
 * membership) cover only the mapped members rather than the full group,
 * return the sentence every surface must print BESIDE those facts. `null`
 * when mapped coverage is complete (memberCount >= siteCount) — no banner
 * needed. The full-group facts (siteCount, ownership mix, land/building
 * split, tax-sale/violation counts) come from the cluster itself and are NOT
 * subject to this floor.
 */
export function areaCoverageNote(
  area: Pick<OpportunityArea, "siteCount" | "memberCount">,
): string | null {
  if (area.memberCount >= area.siteCount) return null;
  return `Detailed site facts (size, zoning, addresses) cover ${area.memberCount} of the ${area.siteCount} sites in this group — the mapped members only. Group totals count all ${area.siteCount} sites.`;
}

/** The two-sentence opportunity summary (fixed template over real fields). */
export function opportunitySummary(area: OpportunityArea): string {
  const landBuilding =
    area.vacantBuildingCount === 0
      ? "vacant lots"
      : area.vacantLandCount === 0
        ? "vacant buildings"
        : "vacant lots and buildings";
  const first = `${area.name} groups ${area.siteCount} nearby ${landBuilding} in ${area.neighborhood}${
    area.corridorContext ? `, along the ${area.corridorContext} corridor context` : ""
  }.`;
  const second =
    "It is worth examining together because nearby vacant sites can sometimes be studied as one reuse opportunity — these are early possibilities from public records, not availability listings.";
  return `${first} ${second}`;
}

// ── Compass disambiguation ───────────────────────────────────────────────────

function compassQualifiers(k: number, axis: "lat" | "lon"): string[] {
  if (k === 2) return axis === "lat" ? ["north", "south"] : ["west", "east"];
  if (k === 3) return axis === "lat" ? ["north", "central", "south"] : ["west", "central", "east"];
  // Rare (>3 areas sharing a street): fall back to deterministic ordinals.
  return Array.from({ length: k }, (_, i) => `area ${i + 1}`);
}

/** Append a compass/ordinal qualifier to any base name shared by >1 area, using
 * the group's centroids (real geometry — never invented). Mutates the passed
 * name array by base-label group; returns the disambiguated names aligned to
 * `bases`. */
function disambiguateNames(
  bases: string[],
  centroids: { lat: number; lon: number }[],
): string[] {
  const names = [...bases];
  const groups = new Map<string, number[]>();
  bases.forEach((base, i) => {
    const g = groups.get(base);
    if (g) g.push(i);
    else groups.set(base, [i]);
  });
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const i of idxs) {
      const c = centroids[i];
      if (c.lat < minLat) minLat = c.lat;
      if (c.lat > maxLat) maxLat = c.lat;
      if (c.lon < minLon) minLon = c.lon;
      if (c.lon > maxLon) maxLon = c.lon;
    }
    const midLat = (minLat + maxLat) / 2;
    const latRange = maxLat - minLat;
    const lonRange = (maxLon - minLon) * Math.cos((midLat * Math.PI) / 180);
    const axis: "lat" | "lon" = latRange >= lonRange ? "lat" : "lon";
    const ordered = [...idxs].sort((a, b) =>
      axis === "lat"
        ? centroids[b].lat - centroids[a].lat || a - b // north (higher lat) first
        : centroids[a].lon - centroids[b].lon || a - b, // west (lower lon) first
    );
    const quals = compassQualifiers(ordered.length, axis);
    ordered.forEach((idx, k) => {
      names[idx] = `${bases[idx]} (${quals[k]})`;
    });
  }
  return names;
}

// ── Derivation ───────────────────────────────────────────────────────────────

function memberFromPoint(p: VacancySitePoint): OpportunityAreaMember {
  return {
    address: p.address,
    propertyType: p.propertyType,
    ownerType: normalizeOwnerType(p.ownerType),
    squareFeet: p.squareFeet,
    zoningClass: p.zoningClass,
    incentiveCount: p.incentiveCount,
    pin: p.pin,
    saleYear: p.saleYear,
    violation: p.violation,
    lat: p.lat,
    lon: p.lon,
  };
}

/** Build one area's derived facts (everything except the display name, which is
 * assigned globally so it can be made unique). */
function buildAreaCore(
  cluster: VacancyCluster,
  members: OpportunityAreaMember[],
  neighborhood: string,
): Omit<OpportunityArea, "name" | "namingSource"> {
  const memberCount = members.length;
  let combinedKnownSqft = 0;
  let sqftUnknownCount = 0;
  let incentiveSiteCount = 0;
  let zoningUnknownCount = 0;
  const zoningFreq = new Map<string, number>();
  const familySet = new Set<ZoningFamily>();
  for (const m of members) {
    if (m.squareFeet != null && Number.isFinite(m.squareFeet)) combinedKnownSqft += m.squareFeet;
    else sqftUnknownCount += 1;
    if (m.incentiveCount > 0) incentiveSiteCount += 1;
    if (m.zoningClass) {
      zoningFreq.set(m.zoningClass, (zoningFreq.get(m.zoningClass) ?? 0) + 1);
      const fam = zoningFamilyOf(m.zoningClass);
      if (fam) familySet.add(fam);
    } else {
      zoningUnknownCount += 1;
    }
  }
  let dominantZoningClass: string | null = null;
  let domCount = -1;
  for (const [code, count] of zoningFreq) {
    if (count > domCount || (count === domCount && dominantZoningClass != null && code < dominantZoningClass)) {
      dominantZoningClass = code;
      domCount = count;
    }
  }
  const zoningFamilies = Array.from(familySet);

  // Ownership CATEGORY mix from the FULL cluster (authoritative, honest zeros).
  const clusterCounts = new Map<OwnerType, number>();
  for (const c of cluster.ownerTypeCounts) clusterCounts.set(normalizeOwnerType(c.ownerType), c.count);
  const ownershipMix: OwnershipCategoryShare[] = OWNER_TYPE_ORDER.map((ownerType) => ({
    ownerType,
    label: PUBLIC_OWNER_TYPE_LABELS[ownerType],
    count: clusterCounts.get(ownerType) ?? 0,
  }));

  const core = {
    clusterId: cluster.id,
    corridorContext: cluster.corridorName?.trim() ? cluster.corridorName.trim() : null,
    neighborhood,
    siteCount: cluster.count,
    memberCount,
    members,
    combinedKnownSqft,
    sqftUnknownCount,
    vacantLandCount: cluster.vacantLandCount,
    vacantBuildingCount: cluster.vacantBuildingCount,
    taxSaleCount: cluster.taxSaleCount,
    violationCount: cluster.violationCount,
    incentiveSiteCount,
    dominantZoningClass,
    zoningGlossText: zoningGloss(dominantZoningClass),
    zoningFamilies,
    ownershipMix,
    bbox: cluster.bbox,
    centroid: cluster.centroid,
  };

  const scenarios = scenariosForArea({
    siteCount: core.siteCount,
    combinedKnownSqft: core.combinedKnownSqft,
    zoningFamilies: core.zoningFamilies,
  });
  const standoutReasons = standoutReasonsForArea({
    siteCount: core.siteCount,
    memberCount: core.memberCount,
    combinedKnownSqft: core.combinedKnownSqft,
    incentiveSiteCount: core.incentiveSiteCount,
    ownershipMix: core.ownershipMix,
    zoningFamilies: core.zoningFamilies,
  });
  const needsChecking = needsCheckingForArea({
    siteCount: core.siteCount,
    memberCount: core.memberCount,
    taxSaleCount: core.taxSaleCount,
    violationCount: core.violationCount,
    zoningUnknownCount,
    ownershipMix: core.ownershipMix,
  });

  return { ...core, scenarios, standoutReasons, needsChecking };
}

export interface DeriveOpportunityAreasResult {
  /** The areas to display (already capped at AREA_DISPLAY_CAP), site count desc. */
  areas: OpportunityArea[];
  /** Qualifying areas beyond the display cap ("+ N more on the property map"). */
  hiddenCount: number;
  /** Total qualifying areas (shown + hidden). */
  totalQualifying: number;
}

/**
 * Derive the public Opportunity Areas for one edition. Only proximity clusters
 * with ≥ MIN_AREA_SITES surface; they are sorted by site count desc (then id),
 * named (street-primary with compass disambiguation, corridor as context), and
 * capped at AREA_DISPLAY_CAP for display.
 */
export function deriveOpportunityAreas(
  edition: VacancyIndexEdition,
  opts: { minSize?: number; cap?: number } = {},
): DeriveOpportunityAreasResult {
  const minSize = opts.minSize ?? MIN_AREA_SITES;
  const cap = opts.cap ?? AREA_DISPLAY_CAP;
  const neighborhood = edition.neighborhood;

  // Group mapped sitePoints by their kept cluster id.
  const membersByCluster = new Map<number, OpportunityAreaMember[]>();
  for (const p of edition.sitePoints) {
    if (p.clusterId == null) continue;
    const arr = membersByCluster.get(p.clusterId);
    if (arr) arr.push(memberFromPoint(p));
    else membersByCluster.set(p.clusterId, [memberFromPoint(p)]);
  }

  const qualifying = (edition.clusters ?? [])
    .filter((c) => c.count >= minSize)
    .map((c) => buildAreaCore(c, membersByCluster.get(c.id) ?? [], neighborhood))
    .sort((a, b) => b.siteCount - a.siteCount || a.clusterId - b.clusterId);

  // Assign names (base label, then compass disambiguation) across the whole
  // qualifying set so identities stay stable regardless of the display cap.
  const bases: string[] = [];
  const sources: OpportunityAreaNamingSource[] = [];
  for (const core of qualifying) {
    const street = modalStreet(core.members);
    if (street) {
      bases.push(`${street} area`);
      sources.push("street");
    } else {
      bases.push(`Area ${core.clusterId} near ${neighborhood}`);
      sources.push("fallback");
    }
  }
  const names = disambiguateNames(
    bases,
    qualifying.map((c) => c.centroid),
  );

  const allAreas: OpportunityArea[] = qualifying.map((core, i) => ({
    ...core,
    name: names[i],
    namingSource: sources[i],
  }));

  const areas = allAreas.slice(0, cap);
  return {
    areas,
    hiddenCount: Math.max(0, allAreas.length - areas.length),
    totalQualifying: allAreas.length,
  };
}

/** One area by its cluster id, or null (for the Revitalization File route). */
export function opportunityAreaById(
  edition: VacancyIndexEdition,
  clusterId: number,
): OpportunityArea | null {
  // Derive with no cap so any qualifying area resolves, and names stay identical
  // to the index page (same global disambiguation input).
  const { areas } = deriveOpportunityAreas(edition, { cap: Number.POSITIVE_INFINITY });
  return areas.find((a) => a.clusterId === clusterId) ?? null;
}
