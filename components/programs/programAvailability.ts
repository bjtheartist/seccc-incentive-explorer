import { resolveAvailability, type ProgramAvailability } from "@/lib/program-gating";
import type { Program } from "@/lib/types";

export function requiresLiveProgramAvailability(program: Program): boolean {
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
  program: Program,
  now: Date | null,
): ProgramAvailability | null {
  if (now) return resolveAvailability(program, now);
  return requiresLiveProgramAvailability(program) ? null : { state: "active" };
}

/** Static metadata may include application guidance only when it cannot expire. */
export function canPublishStaticApplicationGuidance(program: Program): boolean {
  return !requiresLiveProgramAvailability(program);
}
