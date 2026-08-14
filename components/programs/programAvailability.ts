import { resolveAvailability, type ProgramAvailability } from "@/lib/program-gating";
import type { Program, ProgramAvailabilityFields, ProgramApplicationView } from "@/lib/types";

// review6 S17: narrowed from `Program` to `ProgramAvailabilityFields` — see
// that type's own doc comment (lib/types.ts). A full `Program` still
// satisfies it structurally, so every existing caller is unaffected.
export function requiresLiveProgramAvailability(program: ProgramAvailabilityFields): boolean {
  return Boolean(
    program.deadlines?.length ||
      program.expiresOn ||
      program.oneTime ||
      program.recurring ||
      program.suspensionNote ||
      program.status === "lapsed" ||
      program.status === "sunset",
  );
}

/**
 * Keep time-sensitive actions closed in server HTML until the browser clock is
 * available. Programs without any time gate can render their stable guidance.
 */
export function resolveConservativeProgramAvailability(
  program: ProgramAvailabilityFields,
  now: Date | null,
): ProgramAvailability | null {
  if (now) return resolveAvailability(program, now);
  return requiresLiveProgramAvailability(program) ? null : { state: "active" };
}

/** Static metadata may include application guidance only when it cannot expire. */
export function canPublishStaticApplicationGuidance(program: ProgramAvailabilityFields): boolean {
  return !requiresLiveProgramAvailability(program);
}

/**
 * review6 S17 (CRITICAL) — the ONLY sanctioned way to build
 * `ProgramApplicationSection`'s `program` prop from a full internal
 * `Program`. `app/programs/[slug]/page.tsx` (a server component) used to
 * pass the full `Program` object directly — whoQualifies, eligibilityRules,
 * contacts, requiredDocs, verificationSteps, and every other internal-only
 * field, serialized into the page's RSC payload. This maps ONLY the fields
 * `ProgramApplicationView` declares (confirmed against the component's own
 * source, see that type's doc comment in lib/types.ts) — nothing else
 * crosses the server/client boundary for this prop.
 */
export function toProgramApplicationView(program: Program): ProgramApplicationView {
  return {
    id: program.id,
    status: program.status,
    suspensionNote: program.suspensionNote,
    sunsetWarning: program.sunsetWarning,
    deadlines: program.deadlines,
    oneTime: program.oneTime,
    expiresOn: program.expiresOn,
    recurring: program.recurring,
    howToApply: program.howToApply,
    fastestConfirmingStep: program.fastestConfirmingStep,
    sourceUrl: program.sourceUrl,
    url: program.url,
  };
}
