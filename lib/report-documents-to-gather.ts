// ─── Documents to Gather (persona spec v2, owner+supporter) ──────────────
// Derived from the REAL Business File foundation-task definitions
// (lib/incentive-preparation.ts `buildPreparationTasks`) — the same task
// registry the actual Business File workspace route builds from. No new
// content is invented here: this reads the identity/address/contact
// confirmation tasks plus the two reusable continuity documents
// (accountant-reviewed financials, tax/good-standing records), every one
// carrying its own real title, description, responsible party, and time
// estimate from that registry.

import { buildPreparationTasks, type PreparationTaskOwner } from "@/lib/incentive-preparation";

export interface DocumentToGatherRow {
  id: string;
  title: string;
  description: string;
  owner: PreparationTaskOwner;
  estimatedWeeks: string;
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
  }));
}

export function documentOwnerLabel(owner: PreparationTaskOwner): string {
  return OWNER_LABELS[owner] ?? "You";
}
