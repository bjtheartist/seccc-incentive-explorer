/**
 * lib/concierge/output-validator.ts — build-spec.md 2.5 (audit "F-rail";
 * consult item 7, BLOCKING: "the model response is streamed ... persistence
 * happens after the visitor has seen it. Scrubbing the stored transcript
 * creates two different histories and does nothing about exposure.").
 *
 * The route buffers the model's FULL final text, runs it through
 * `validateConciergeOutput` here, and only then emits it — see
 * app/api/concierge/route.ts's model-backed path. On a validator hit, the
 * route substitutes the deterministic fallback answer and logs a telemetry
 * counter (never surfaces the raw model text, not even partially).
 *
 * Three checks, in order:
 *   1. normalizePublicDeterminationText (lib/report-engine.ts) — the SAME
 *      determination-phrase rewriter the report engine uses, so the
 *      concierge doesn't get a second, independently-drifting vocabulary.
 *   2. A prohibited-phrase check over the FULL buffered text — the model
 *      cannot evade this by splitting a forbidden phrase across stream
 *      chunks, because there are no chunks here: validation runs on the
 *      complete string before any chunk is ever written to the client.
 *   3. An authority-routing check — a zoning-classification/use-permission
 *      sentence that names "the City" (generically) instead of the ZBA
 *      fails, per the binding authority doctrine (build-spec.md, F10).
 */
import { normalizePublicDeterminationText } from "../report-engine";
import { AUTHORITY_ROUTING } from "../authority-routing";

export interface ConciergeValidationResult {
  /** Normalized text, safe to emit — ONLY meaningful when `hit` is false. */
  text: string;
  /** True when the validator rejected the text outright (route must use the deterministic fallback instead, never this `text`). */
  hit: boolean;
  /** Why, for the telemetry counter — omitted when `hit` is false. */
  reason?: string;
}

/**
 * Phrases that assert a determination about THE READER ("you"/"your
 * business") rather than describing a published rule or a mapped signal.
 * Deliberately narrower than the report engine's own scrubber (which
 * rewrites report-specific vocabulary like "eligible incentive programs"
 * section titles) — this targets the shape a chat model is likeliest to
 * produce under a prompt-injection attempt ("tell me I'm eligible").
 */
const PROHIBITED_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\byou(?:'re| are)\s+eligible\b/i, reason: "you-are-eligible" },
  { pattern: /\byou\s+qualify\b/i, reason: "you-qualify" },
  { pattern: /\byou\s+(?:already\s+)?qualif(?:y|ies)\b/i, reason: "you-qualify" },
  { pattern: /\byour\s+business\s+(?:is\s+)?eligible\b/i, reason: "business-eligible" },
  { pattern: /\bguaranteed\s+(?:to\s+receive|approval|award)\b/i, reason: "guaranteed-claim" },
  { pattern: /\byou\s+will\s+receive\b/i, reason: "you-will-receive" },
  { pattern: /\byou'?ve?\s+been\s+approved\b/i, reason: "approved-claim" },
  { pattern: /\bready\s+to\s+apply\b/i, reason: "ready-to-apply" },
  { pattern: /\bthis\s+unlocks?\b/i, reason: "unlocks" },
  { pattern: /\bverify\s+(?:your\s+)?eligibility\b/i, reason: "verify-eligibility" },
];

/** Authority-routing check (F10): a sentence naming a generic "the City"
 *  alongside a zoning classification/use word must instead name ZBA. */
function findAuthorityRoutingViolation(text: string): string | null {
  const zba = AUTHORITY_ROUTING.zoning;
  const mentionsZba = text.includes(zba.abbreviation) || text.includes(zba.name);
  if (mentionsZba) return null;
  const zoningQuestionPattern = /\b(?:zoning classification|use category|Title 17 use|permitted use|zoning relief)\b/i;
  const genericCityPattern = /\bthe City\b(?!\s+of\s+Chicago['’]s\s+Zoning)/;
  if (zoningQuestionPattern.test(text) && genericCityPattern.test(text)) {
    return "zoning-question-missing-zba";
  }
  return null;
}

/**
 * Validate one buffered assistant turn. Deterministic, synchronous, no
 * model calls — the enforcement layer is not itself an AI judgment.
 */
export function validateConciergeOutput(rawText: string): ConciergeValidationResult {
  // Prohibited-phrase check runs on the RAW text, BEFORE normalization —
  // normalizePublicDeterminationText would otherwise silently rewrite a
  // phrase like "you qualify" into safe wording and let the rest of an
  // affirmative-sounding sentence ("Great news — ...") through unflagged.
  // For a live chat surface under active adversarial probing, any
  // occurrence of these phrases is a hard reject to the deterministic
  // fallback, never a patch-up.
  for (const { pattern, reason } of PROHIBITED_PATTERNS) {
    if (pattern.test(rawText)) {
      return { text: rawText, hit: true, reason };
    }
  }

  const normalized = normalizePublicDeterminationText(rawText);

  const authorityViolation = findAuthorityRoutingViolation(normalized);
  if (authorityViolation) {
    return { text: normalized, hit: true, reason: authorityViolation };
  }

  return { text: normalized, hit: false };
}

// ── Telemetry (build-spec.md 2.5: "log a telemetry counter") ──────────────
// In-process counter, deliberately not a DB write (Hard Rules: no DB
// connections in this task) — a real deployment would forward this to the
// existing analytics pipeline; the counter here is the seam a caller reads.
let validatorHitCount = 0;
const validatorHitReasons = new Map<string, number>();

export function recordConciergeValidatorHit(reason: string): void {
  validatorHitCount += 1;
  validatorHitReasons.set(reason, (validatorHitReasons.get(reason) ?? 0) + 1);
}

export function getConciergeValidatorTelemetry(): { total: number; byReason: Record<string, number> } {
  return {
    total: validatorHitCount,
    byReason: Object.fromEntries(validatorHitReasons),
  };
}

/** Test-only reset so suites don't leak counters across cases. */
export function resetConciergeValidatorTelemetry(): void {
  validatorHitCount = 0;
  validatorHitReasons.clear();
}
