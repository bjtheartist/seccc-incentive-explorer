import type {
  EligibilityRule,
  MatchTransparencyContact,
  Program,
  ProgramContact,
  PublicMatchExplanation,
} from "./types";

export interface PublicMatchEvidence {
  whyItAppears?: readonly string[];
  knownFromPublicData?: readonly string[];
  basedOnUserAnswers?: readonly string[];
  rulesEstablishedByPublicData?: readonly string[];
}

const CRITERION_LABELS: Record<string, string> = {
  location: "Program location and boundary requirements",
  industry: "Industry and business-activity requirements",
  propertyType: "Property type and site-control requirements",
  investmentSize: "Project scope, investment, hiring, or use-of-funds requirements",
  businessSize: "Business size and financial requirements",
  hiring: "Hiring and workforce requirements",
  ownership: "Ownership and control requirements",
};

function uniqueNonEmpty(values: readonly string[] | undefined): string[] {
  return Array.from(
    new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
  );
}

function normalizeAgency(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function contactMatchesAgency(contact: ProgramContact, agency: string): boolean {
  const target = normalizeAgency(agency);
  const names = [contact.agency, contact.abbreviation]
    .map(normalizeAgency)
    .filter(Boolean);

  return names.some(
    (name) => name === target || name.startsWith(target) || target.startsWith(name),
  );
}

function publicContact(
  agency: string,
  contact?: ProgramContact,
  url?: string,
): MatchTransparencyContact {
  return {
    agency,
    abbreviation: contact?.abbreviation || undefined,
    phone: contact?.phone?.trim() || undefined,
    email: contact?.email?.trim() || undefined,
    url: url?.trim() || contact?.url?.trim() || undefined,
    role: contact?.role?.trim() || undefined,
  };
}

function confirmationContacts(program: Program): MatchTransparencyContact[] {
  const contacts = program.contacts ?? [];
  const steps = program.verificationSteps ?? [];
  const results: MatchTransparencyContact[] = [];
  const seen = new Set<string>();

  for (const step of steps) {
    const key = normalizeAgency(step.agency);
    if (!key || seen.has(key)) continue;
    const contact = contacts.find((candidate) =>
      contactMatchesAgency(candidate, step.agency),
    );
    results.push(publicContact(step.agency, contact, step.url));
    seen.add(key);
  }

  if (results.length === 0) {
    for (const contact of contacts) {
      const key = normalizeAgency(contact.agency);
      if (!key || seen.has(key)) continue;
      results.push(publicContact(contact.agency, contact));
      seen.add(key);
    }
  }

  if (results.length === 0 && program.contact.trim()) {
    results.push({ agency: program.contact.trim() });
  }

  return results;
}

function neutralConfirmationLabel(rule: EligibilityRule): string {
  const label =
    CRITERION_LABELS[rule.criterion] ?? "Other published program requirements";
  return rule.required ? label : `${label} (additional program condition)`;
}

function statusContext(program: Program): string[] {
  switch (program.status) {
    case "changed":
      return ["The program record notes recent changes; confirm the current terms."];
    case "verify":
      return ["The program record is marked for a current-status review."];
    case "pending":
      return ["The program record is marked pending; confirm whether it is accepting requests."];
    case "lapsed":
      return ["The program record notes that its authority has lapsed."];
    case "sunset":
      return ["The program record notes a scheduled end or transition."];
    default:
      return [];
  }
}

/**
 * Build the only shape intended for public match explanations.
 * Ranking inputs, confidence, benefit ranges, and project-value estimates are
 * deliberately absent from both the input and output contracts.
 */
export function buildPublicMatchExplanation(
  program: Program,
  evidence: PublicMatchEvidence = {},
): PublicMatchExplanation {
  const basedOnUserAnswers = uniqueNonEmpty(evidence.basedOnUserAnswers);
  const whyItAppears = uniqueNonEmpty(evidence.whyItAppears);
  const establishedRules = new Set(
    uniqueNonEmpty(evidence.rulesEstablishedByPublicData),
  );

  const knownFromPublicData = uniqueNonEmpty([
    ...(evidence.knownFromPublicData ?? []),
    ...(program.lastVerifiedAt
      ? [`Program information was last reviewed on ${program.lastVerifiedAt}.`]
      : []),
    ...statusContext(program),
  ]);

  const stillToConfirm = uniqueNonEmpty(
    (program.eligibilityRules ?? [])
      .filter((rule) => !establishedRules.has(rule.description.trim()))
      .map(neutralConfirmationLabel),
  );

  const sourceUrl = program.sourceUrl?.trim() || program.url?.trim();

  return {
    whyItAppears:
      whyItAppears.length > 0
        ? whyItAppears
        : basedOnUserAnswers.length > 0
          ? ["Your selected business and project details overlap with this program's published focus."]
          : ["This general business-support program is included as a starting point."],
    knownFromPublicData,
    basedOnUserAnswers,
    stillToConfirm,
    currentDocumentsToGather: uniqueNonEmpty(program.requiredDocs),
    confirmWith: confirmationContacts(program),
    officialSource: sourceUrl
      ? { label: `Official ${program.name} source`, url: sourceUrl }
      : undefined,
    lastVerifiedAt: program.lastVerifiedAt,
  };
}
