/**
 * lib/program-fact.ts — build-spec.md 2.2 (audit F6/F7/F9; consult item 9).
 *
 * Hand-authored content (FAQ, Answers SEO pages, the quiz bank) previously
 * hard-coded program facts as free text, which drifted out of sync with the
 * catalog the moment a program's status/terms changed (audit's exact
 * finding: FAQ describing MMRP as a still-open storefront-grant program
 * after the catalog record itself became CNRP, closed, $15,000 homeownership
 * assistance). The consult explicitly rejected a standalone "drift manifest"
 * (a second copy of every fact that itself goes stale) in favor of pulling
 * facts through a typed accessor at render/build time, so the content and
 * the catalog can never silently diverge — a rendered-output test is what
 * actually proves it (see e.g. lib/__tests__/answers-data.test.ts).
 *
 * A build-time static import (not `getProgramsSync()`'s fs read) so this
 * module works from BOTH server modules (lib/answers-data.ts,
 * lib/quiz-bank-extension.ts) AND the client-rendered app/faq/page.tsx
 * ("use client") without a server/client split — same bundling
 * characteristic already accepted for ProgramsCatalog and survey-engine.ts
 * (see docs/eligibility-claims-acceptance.md).
 */
import catalog from "@/data/programs-internal.json";
import type { Program } from "./types";
import { toPublicProgramView, type PublicProgramView } from "./program-public";

const PROGRAMS = catalog as unknown as Program[];
const BY_ID = new Map(PROGRAMS.map((p) => [p.id, p]));

/** Look up one internal catalog record by id. Throws on an unknown id —
 *  a typo here should fail loudly at test time, never render silently blank. */
export function programRecord(programId: string): Program {
  const program = BY_ID.get(programId);
  if (!program) {
    throw new Error(`programFact: unknown program id "${programId}"`);
  }
  return program;
}

/** Pull one fact off a catalog record via a typed selector, e.g.
 *  `programFact("nof", (p) => p.benefitRange)`. */
export function programFact<T>(programId: string, selector: (program: Program) => T): T {
  return selector(programRecord(programId));
}

/** The structured public view (status, qualifier, published criteria) for
 *  one catalog record — the same DTO every other public surface renders
 *  from. `asOf` defaults to the record's own `statusAsOf`. */
export function programView(programId: string, asOf?: string): PublicProgramView {
  const program = programRecord(programId);
  return toPublicProgramView(program, asOf ?? program.statusAsOf ?? new Date().toISOString());
}

/** The one binding qualifier sentence for a program's benefit terms
 *  (lib/program-public.ts's benefitQualifier, via the DTO). */
export function programQualifier(programId: string): string {
  return programView(programId).benefit.qualifier;
}
