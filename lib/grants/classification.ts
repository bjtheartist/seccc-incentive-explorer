import reference from "@/data/naics-2022.json";

export const NAICS_EDITION = "2022" as const;
export const naicsCodes = reference.codes;
const byCode = new Map(naicsCodes.map((row) => [row.code, row]));
export const naicsBusinessTypes = naicsCodes.filter((row) =>
  /^\d{6}$/.test(row.code),
);
export const naicsSectors = naicsCodes.filter((row) =>
  /^\d{2}(-\d{2})?$/.test(row.code),
);
export const businessStructures = {
  unknown: "Not confirmed",
  sole_proprietor: "Sole proprietor",
  partnership: "Partnership",
  llc: "Limited liability company (LLC)",
  corporation: "Corporation",
  cooperative: "Cooperative",
  trust: "Trust",
  other: "Other legal structure",
} as const;
export const spaceArrangements = {
  unknown: "Not confirmed",
  owns: "Owns the project space",
  leases: "Leases the project space",
  seeking: "Location not yet secured",
  not_applicable: "No premises needed for this project",
} as const;
export function naicsMatches(code: string, criterion: string) {
  if (criterion === "any") return true;
  if (!byCode.has(code) || !byCode.has(criterion)) return false;
  if (criterion.includes("-")) {
    const [start, end] = criterion.split("-").map(Number);
    const sector = Number(code.slice(0, 2));
    return sector >= start && sector <= end;
  }
  return code.startsWith(criterion);
}
export function isNaicsCriterion(code: string) {
  return code === "any" || byCode.has(code);
}
export function classificationFor(code: string | null | undefined) {
  const activity = code ? byCode.get(code) : undefined;
  if (!activity || activity.code.length !== 6) return null;
  const sector = naicsSectors.find((row) =>
    naicsMatches(activity.code, row.code),
  )!;
  return {
    naicsCode: activity.code,
    naicsEdition: NAICS_EDITION,
    businessType: activity.title,
    industryCode: sector.code,
    industry: sector.title,
  };
}

/** Additive read compatibility; never guess an activity from legacy descriptions. */
export function normalizeApplicantClassification(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const a = input as Record<string, unknown>;
  const legacy = a.naicsEdition === undefined;
  const oldType = typeof a.businessType === "string" ? a.businessType : "";
  const structure = (
    {
      llc: "llc",
      corporation: "corporation",
      partnership: "partnership",
      "sole proprietor": "sole_proprietor",
    } as Record<string, string>
  )[oldType.toLowerCase()];
  const classification = classificationFor(
    typeof a.naicsCode === "string" ? a.naicsCode : null,
  );
  return {
    ...a,
    ...(legacy
      ? {
          legacyBusinessType: oldType,
          legacyIndustry: a.industry || "",
          businessStructure: a.businessStructure || structure || "unknown",
        }
      : {}),
    ...(a.role === "tenant"
      ? { role: "operator", spaceArrangement: "leases" }
      : {}),
    businessType: "",
    industry: "",
    industryCode: "",
    ...classification,
    naicsEdition: a.naicsEdition ?? NAICS_EDITION,
  };
}
