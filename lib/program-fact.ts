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
 * review5 S1 (CRITICAL): this module used to statically import
 * data/programs-internal.json (the full internal catalog, including
 * whoQualifies, benefits, requiredDocs, etc.) into every client bundle that
 * transitively imports it — app/faq/page.tsx is "use client". It now
 * imports public/data/programs-public.json (PR1's committed, sanitized DTO
 * envelope) instead, and `programFact()`'s selector type is restricted to
 * `PublicProgramView` fields — a call site cannot reach an internal-only
 * field even by accident, because the underlying data literally does not
 * carry one. A build-time static import (not a runtime fetch) so this
 * module works from BOTH server modules (lib/answers-data.ts,
 * lib/quiz-bank-extension.ts) AND the client-rendered app/faq/page.tsx
 * without a server/client split.
 */
import catalog from "@/public/data/programs-public.json";
import { toPublicProgramView, type PublicProgramView } from "./program-public";

const PROGRAMS = catalog.programs as unknown as PublicProgramView[];
const BY_ID = new Map(PROGRAMS.map((p) => [p.id, p]));

/** Look up one program's public projection by id. Throws on an unknown id —
 *  a typo here should fail loudly at test time, never render silently blank. */
export function programRecord(programId: string): PublicProgramView {
  const program = BY_ID.get(programId);
  if (!program) {
    throw new Error(`programFact: unknown program id "${programId}"`);
  }
  return program;
}

/** Pull one fact off a program's PUBLIC projection via a typed selector,
 *  e.g. `programFact("nof", (p) => p.benefit.summary)`. The selector type
 *  is `PublicProgramView`, not the internal `Program` — an internal-only
 *  field (whoQualifies, benefits[], requiredDocs, ...) is not reachable
 *  here even by a careless call site. */
export function programFact<T>(programId: string, selector: (program: PublicProgramView) => T): T {
  return selector(programRecord(programId));
}

/** The structured public view (status, qualifier, published criteria) for
 *  one catalog record — the same DTO every other public surface renders
 *  from. Re-projects through toPublicProgramView is unnecessary here (the
 *  committed artifact already IS the projection); kept as a thin alias so
 *  existing call sites (`programView(id)`) don't need to change shape. */
export function programView(programId: string): PublicProgramView {
  return programRecord(programId);
}

/** The one binding qualifier sentence for a program's benefit terms
 *  (lib/program-public.ts's benefitQualifier, baked into the DTO at export
 *  time). */
export function programQualifier(programId: string): string {
  return programView(programId).benefit.qualifier;
}

// toPublicProgramView is re-exported only so lib/__tests__/program-fact.test.ts
// can cross-check this module's DTO values against a fresh projection of the
// same catalog record without importing the internal catalog itself in a
// test that exists to prove the CLIENT-SAFE path is correct.
export { toPublicProgramView };
