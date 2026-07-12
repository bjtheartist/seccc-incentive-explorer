/**
 * Stage 3 abuse-detection basics for the Site Concierge.
 *
 * Layered, cheap, and fail-safe. None of this is a substitute for the system
 * prompt's boundary rules or the server-side ownership checks — it is a
 * speed-bump that keeps the obvious attacks (prompt injection smuggled through
 * page-context fields, oversized inputs, repeated hammering) from reaching the
 * model or the action tools.
 *
 * Covered here (design note §6 / task item 7):
 *   - Max input length (enforced in the route via CONCIERGE_MAX_MESSAGE_CHARS;
 *     re-exported guard here for page-context strings).
 *   - Strip/refuse prompt-injection markers in the CLIENT-SUPPLIED page context
 *     (address, report summary, program names) — those fields are DATA and must
 *     never carry instructions.
 *   - Repeated-429 backoff (escalating retry-after) lives in rate-limit.ts.
 *   - A profanity / off-domain refusal note is added to the system prompt.
 */
import type { ConciergePageContext } from "./types";

/**
 * Case-insensitive markers of the classic "ignore your instructions" family of
 * prompt-injection attempts. Kept deliberately narrow (high precision) so we do
 * not mangle a legitimate business description that happens to say "system".
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (?:all |any |the )?(?:previous |prior |above )?(?:instructions|prompts?|rules)/i,
  /disregard (?:all |any |the )?(?:previous |prior |above )?(?:instructions|prompts?|rules)/i,
  /forget (?:everything|all|your) (?:instructions|rules|prompt)/i,
  /you are now (?:a|an|the|no longer)/i,
  /(?:act|behave|respond) as (?:if you are |a |an |the )?(?:dan|jailbreak|developer mode)/i,
  /system prompt/i,
  /reveal (?:your |the )?(?:system |hidden )?(?:prompt|instructions)/i,
  /override (?:your |the |all )?(?:safety|rules|instructions|guardrails)/i,
  /\bBEGIN\s+(?:SYSTEM|PROMPT)\b/i,
  /<\/?(?:system|instructions?)>/i,
];

/** True if the text carries an obvious injection marker. */
export function containsInjectionMarker(value: string): boolean {
  if (!value) return false;
  return INJECTION_PATTERNS.some((re) => re.test(value));
}

/**
 * Replace injection markers with a neutral placeholder so the field survives as
 * DATA without carrying an instruction. We redact rather than drop the whole
 * field so a genuine address/summary with an unlucky phrase still renders.
 */
function redactInjection(value: string): string {
  let out = value;
  for (const re of INJECTION_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"), "[redacted]");
  }
  return out;
}

export interface PageContextScreenResult {
  /** The page context with any injection markers in string fields redacted. */
  context: ConciergePageContext;
  /** Field names in which an injection marker was found (for telemetry/logs). */
  flagged: string[];
}

/**
 * Screen the CLIENT-SUPPLIED page context for injection markers, redacting them
 * in place. Runs AFTER sanitizePageContext (which already clamps lengths). The
 * model is separately told to treat these fields as data, but redaction removes
 * the payload before it ever reaches the prompt.
 */
export function screenPageContext(
  context: ConciergePageContext
): PageContextScreenResult {
  const flagged: string[] = [];
  const scrub = (field: keyof ConciergePageContext, value?: string) => {
    if (typeof value !== "string" || !value) return value;
    if (!containsInjectionMarker(value)) return value;
    flagged.push(field);
    return redactInjection(value);
  };

  const visiblePrograms = context.visiblePrograms?.map((p, i) => {
    if (containsInjectionMarker(p)) {
      flagged.push(`visiblePrograms[${i}]`);
      return redactInjection(p);
    }
    return p;
  });

  return {
    context: {
      ...context,
      pageLabel: scrub("pageLabel", context.pageLabel),
      reportSummary: scrub("reportSummary", context.reportSummary),
      address: scrub("address", context.address),
      visiblePrograms,
    },
    flagged,
  };
}
