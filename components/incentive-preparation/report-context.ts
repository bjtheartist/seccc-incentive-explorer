import type { GeneratedReport } from "@/lib/report-engine";
import type { WizardState } from "@/lib/report-wizard-config";
import { startHereActionsInOrder } from "@/lib/start-here";

export const PREPARATION_CONTEXT_STORAGE_KEY =
  "seccc.incentive-preparation.context.v1";

export const MAX_PREPARATION_PROGRAM_CANDIDATES = 4;

export interface PreparationProgramCandidate {
  programId: string;
  label: string;
}

export interface PreparationContext {
  projectId: string;
  address: string;
  projectGoal: string;
  industry: string;
  programs: PreparationProgramCandidate[];
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const cleaned = cleanString(value);
    if (cleaned) return cleaned;
  }
  return "";
}

function collectProgramCandidates(
  report: GeneratedReport,
): PreparationProgramCandidate[] {
  const candidates: PreparationProgramCandidate[] = [];
  const seenProgramIds = new Set<string>();

  const addCandidate = (programIdValue: unknown, labelValue: unknown) => {
    const programId = cleanString(programIdValue);
    const label = cleanString(labelValue);
    if (!programId || !label || seenProgramIds.has(programId)) return;

    seenProgramIds.add(programId);
    candidates.push({ programId, label });
  };

  for (const section of report.sections) {
    for (const item of section.items) {
      addCandidate(item.programId, item.label);
      if (candidates.length >= MAX_PREPARATION_PROGRAM_CANDIDATES) {
        return candidates;
      }
    }
  }

  // Prefer the canonical startHere model (lib/start-here.ts) for program-id
  // sourcing: it is the single place "what is the top program" is decided,
  // so its primary+secondary actions win whenever a report was generated
  // with one attached. `actionRoadmap` remains the fallback source for
  // reports saved before startHere existed (report.startHere is undefined
  // there, never "empty") — this keeps preparation packets identical for
  // every legacy report.
  if (report.startHere) {
    for (const action of startHereActionsInOrder(report.startHere)) {
      addCandidate(action.programId, action.label);
      if (candidates.length >= MAX_PREPARATION_PROGRAM_CANDIDATES) {
        return candidates;
      }
    }
    return candidates;
  }

  for (const item of report.actionRoadmap ?? []) {
    addCandidate(item.programId, item.programName ?? item.label);
    if (candidates.length >= MAX_PREPARATION_PROGRAM_CANDIDATES) {
      return candidates;
    }
  }

  return candidates;
}

export function extractPreparationContext(
  report: GeneratedReport,
  wizardState?: WizardState,
): PreparationContext {
  return {
    projectId: "",
    address: firstString(wizardState?.address, report.metadata.address),
    projectGoal: firstString(
      wizardState?.projectType,
      report.metadata.projectType,
      wizardState?.proposedUse,
      report.metadata.proposedUse,
    ),
    industry: firstString(wizardState?.industry, report.metadata.industry),
    programs: collectProgramCandidates(report),
  };
}

export function parsePreparationContext(
  storedValue: string | null | undefined,
): PreparationContext | null {
  if (!storedValue) return null;

  try {
    const parsed: unknown = JSON.parse(storedValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.programs)) return null;

    const programs: PreparationProgramCandidate[] = [];
    const seenProgramIds = new Set<string>();

    for (const value of record.programs) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const candidate = value as Record<string, unknown>;
      const programId = cleanString(candidate.programId);
      const label = cleanString(candidate.label);
      if (!programId || !label || seenProgramIds.has(programId)) continue;

      seenProgramIds.add(programId);
      programs.push({ programId, label });
      if (programs.length >= MAX_PREPARATION_PROGRAM_CANDIDATES) break;
    }

    return {
      projectId: cleanString(record.projectId),
      address: cleanString(record.address),
      projectGoal: cleanString(record.projectGoal),
      industry: cleanString(record.industry),
      programs,
    };
  } catch {
    return null;
  }
}
