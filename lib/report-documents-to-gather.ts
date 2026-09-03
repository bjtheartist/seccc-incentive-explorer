// ─── Documents to Gather (persona spec v2, owner+supporter) ──────────────
// Program-linked rows use the same up-to-three programs named in the persona
// summary and each program's published document checklist. When those records
// provide no checklist, the REAL Business File foundation-task definitions
// (lib/incentive-preparation.ts `buildPreparationTasks`) supply an explicitly
// labeled shared-preparation fallback.

import {
  classifyDocumentPreparationCost,
  type DocumentPreparationCostSignal,
} from "@/lib/document-preparation-cost";
import { buildPreparationTasks, type PreparationTaskOwner } from "@/lib/incentive-preparation";
import { personaSummaryProgramNames } from "@/lib/report-personas";
import type { GeneratedReport, ReportItem } from "@/lib/report-engine";

export interface DocumentToGatherRow {
  id: string;
  title: string;
  description: string;
  owner?: PreparationTaskOwner;
  estimatedWeeks?: string;
  programReferences?: Array<{ programId: string; label: string }>;
  whyLine?: string;
  /**
   * Preparation-cost tier for this row, classified from the row TITLE alone —
   * the same input the canonical engine sections use (lib/report-engine.ts
   * classifies `d.doc` for "Required Documents" and `doc.label` for the
   * "Document Readiness Checklist"), so one document cannot be published as
   * "$$$" on the All view and "$" on a persona board. The row DESCRIPTION is
   * deliberately excluded: it is boilerplate ("...among the documents to
   * gather...") shared by every program-linked row, and feeding it to the
   * keyword classifier would let one row's wording leak into another's tier.
   *
   * Regression this closes: #211 dropped the "rest"/"documentReadiness"
   * buckets from every PERSONA_SECTION_ORDER — the two canonical sections
   * that PRINT the tier — and in the same commit renamed this supplement's
   * heading to "Document readiness". The section kept the name and lost the
   * dollar value. `?` stays a first-class tier here (see
   * lib/document-preparation-cost.ts): an unclassified document is published
   * as undetermined, never as cheap.
   */
  preparationCost: DocumentPreparationCostSignal;
}

const OWNER_LABELS: Record<PreparationTaskOwner, string> = {
  business: "You",
  advisor: "An advisor",
  accountant: "Your accountant",
  landlord: "Your landlord",
  local_partner: "A local partner",
  program_administrator: "The program administrator",
};

function weekRange(min: number, max: number): string {
  if (min === max) return `~${min} week${min === 1 ? "" : "s"}`;
  return `~${min}–${max} weeks`;
}

/**
 * The foundation-scope tasks — program-agnostic, preparable before any
 * specific incentive program is chosen. Calling buildPreparationTasks()
 * with no goal/profile is exactly how the Business File workspace route
 * itself builds a fresh, unstarted packet's task list.
 */
export function buildDocumentsToGather(): DocumentToGatherRow[] {
  const tasks = buildPreparationTasks({ profile: {} });
  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    description: task.description,
    owner: task.owner,
    estimatedWeeks: weekRange(task.estimatedMinWeeks, task.estimatedMaxWeeks),
    preparationCost: classifyDocumentPreparationCost(task.title),
  }));
}

function programItemsById(report: GeneratedReport): Map<string, ReportItem> {
  const items = new Map<string, ReportItem>();
  for (const section of report.sections ?? []) {
    for (const item of section.items ?? []) {
      if (item.programId && !items.has(item.programId)) items.set(item.programId, item);
    }
  }
  return items;
}

/**
 * Connect readiness directly to the same up-to-three programs named in the
 * persona executive summary. Exact document strings come from each program's
 * public match explanation; duplicates are merged without losing attribution.
 *
 * Some surfaced programs legitimately publish no document list. In that case
 * the Business File foundation remains useful, but is labeled explicitly as
 * shared preparation rather than a program-specific requirement.
 */
export function buildProgramLinkedDocumentsToGather(
  report: GeneratedReport,
): DocumentToGatherRow[] {
  const summaryPrograms = personaSummaryProgramNames(report);
  const items = programItemsById(report);
  const rowsByDocument = new Map<
    string,
    { title: string; programReferences: Array<{ programId: string; label: string }> }
  >();

  for (const program of summaryPrograms) {
    const item = items.get(program.programId);
    for (const rawDocument of item?.matchExplanation?.currentDocumentsToGather ?? []) {
      const title = rawDocument.trim();
      if (!title) continue;
      const key = title.toLowerCase();
      const row = rowsByDocument.get(key) ?? { title, programReferences: [] };
      if (!row.programReferences.some(({ programId }) => programId === program.programId)) {
        row.programReferences.push(program);
      }
      rowsByDocument.set(key, row);
    }
  }

  if (rowsByDocument.size > 0) {
    return Array.from(rowsByDocument.values()).map((row, index) => ({
      id: `surfaced-program-document-${index + 1}`,
      title: row.title,
      description:
        "This appears because the published program record lists it among the documents to gather. Confirm the current checklist before applying.",
      programReferences: row.programReferences,
      whyLine: "The published program record lists this document for the surfaced program.",
      preparationCost: classifyDocumentPreparationCost(row.title),
    }));
  }

  const references = summaryPrograms.map(({ programId, label }) => ({ programId, label }));
  return buildDocumentsToGather().map((row) => ({
    ...row,
    programReferences: references,
    whyLine:
      "Shared Business File preparation for the programs surfaced above; not a program-specific requirement.",
  }));
}

export function documentOwnerLabel(owner: PreparationTaskOwner): string {
  return OWNER_LABELS[owner] ?? "You";
}
