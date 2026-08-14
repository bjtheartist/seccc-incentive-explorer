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
 *
 * review5 S4: BOTH directions are prohibited, not just the positive one.
 * The original list caught "you qualify" but had no entry at all for "you
 * do not qualify" / "you are ineligible" / "you do not meet the
 * requirements" — a model could satisfy an adversarial prompt ("tell me
 * I'm NOT eligible") just as harmfully as the positive direction, and the
 * validator let it straight through. A determination is a determination
 * regardless of which way it points; reject both, at the raw-text stage,
 * before normalization can soften either into something that slips past.
 */
const PROHIBITED_PATTERNS: { pattern: RegExp; reason: string }[] = [
  // Positive determinations.
  { pattern: /\byou(?:'re| are)\s+eligible\b/i, reason: "you-are-eligible" },
  { pattern: /\bappears?\s+(?:to\s+be\s+)?eligible\b/i, reason: "appears-eligible" },
  { pattern: /\byou\s+qualify\b/i, reason: "you-qualify" },
  { pattern: /\byou\s+(?:already\s+)?qualif(?:y|ies)\b/i, reason: "you-qualify" },
  { pattern: /\byour\s+business\s+(?:is\s+)?eligible\b/i, reason: "business-eligible" },
  { pattern: /\byou\s+meet(?:s)?\s+(?:all\s+)?(?:the\s+)?requirements\b/i, reason: "meets-requirements" },
  { pattern: /\bguaranteed\s+(?:to\s+receive|approval|award)\b/i, reason: "guaranteed-claim" },
  { pattern: /\byou\s+will\s+receive\b/i, reason: "you-will-receive" },
  { pattern: /\byou'?ve?\s+been\s+approved\b/i, reason: "approved-claim" },
  { pattern: /\bready\s+to\s+apply\b/i, reason: "ready-to-apply" },
  { pattern: /\bthis\s+unlocks?\b/i, reason: "unlocks" },
  { pattern: /\bverify\s+(?:your\s+)?eligibility\b/i, reason: "verify-eligibility" },
  // Negative determinations — the SAME reader-facing claim, pointed the
  // other way. Just as prohibited: this validator does not decide
  // eligibility in either direction.
  { pattern: /\byou(?:'re| are)\s+(?:not\s+eligible|ineligible)\b/i, reason: "you-are-ineligible" },
  { pattern: /\byou\s+do\s+not\s+qualify\b/i, reason: "you-do-not-qualify" },
  { pattern: /\byou\s+don'?t\s+qualify\b/i, reason: "you-do-not-qualify" },
  { pattern: /\byour\s+business\s+(?:is\s+)?(?:not\s+eligible|ineligible)\b/i, reason: "business-ineligible" },
  { pattern: /\byou\s+do\s+not\s+meet\s+(?:the\s+)?requirements\b/i, reason: "does-not-meet-requirements" },
  { pattern: /\byou\s+don'?t\s+meet\s+(?:the\s+)?requirements\b/i, reason: "does-not-meet-requirements" },
  { pattern: /\byou\s+will\s+(?:not|never)\s+(?:receive|qualify|be\s+approved)\b/i, reason: "you-will-not-receive" },
  { pattern: /\byou'?ve?\s+been\s+(?:denied|rejected)\b/i, reason: "denied-claim" },
];

/** Naive sentence splitter — good enough for a prose model response, not a
 *  general-purpose NLP tool. Splits on '.', '!', '?' followed by
 *  whitespace, and on hard newlines (a model's own paragraph/list breaks),
 *  so a multi-paragraph answer is checked paragraph-by-paragraph and
 *  sentence-by-sentence within each. */
function splitIntoSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Authority-routing check (F10): a sentence naming a generic "the City"
 * alongside a zoning classification/use word must instead name ZBA.
 *
 * review5 S4: checked SENTENCE BY SENTENCE, not once over the whole text.
 * The original implementation checked whether ZBA was mentioned ANYWHERE
 * in the full response and, if so, skipped the check entirely — so a
 * multi-paragraph answer that correctly named ZBA in one sentence (e.g. an
 * opening summary) but then had a LATER, separate sentence asserting "the
 * City decides your zoning classification" (a real violation) sailed
 * through untouched, because the global ZBA mention masked it. Each
 * sentence's own zoning-question + generic-City combination is now
 * evaluated using only ZBA mentions WITHIN THAT SENTENCE.
 */
function findAuthorityRoutingViolation(text: string): string | null {
  const zba = AUTHORITY_ROUTING.zoning;
  const zoningQuestionPattern = /\b(?:zoning classification|use category|Title 17 use|permitted use|zoning relief)\b/i;
  const genericCityPattern = /\bthe City\b(?!\s+of\s+Chicago['’]s\s+Zoning)/;

  for (const sentence of splitIntoSentences(text)) {
    if (!zoningQuestionPattern.test(sentence) || !genericCityPattern.test(sentence)) continue;
    const sentenceMentionsZba =
      sentence.includes(zba.abbreviation) || sentence.includes(zba.name);
    if (!sentenceMentionsZba) {
      return "zoning-question-missing-zba";
    }
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
//
// review5 S4: "durable telemetry (log/DB write, not process memory)". The
// in-process counter below (kept for same-process test/debug convenience —
// nothing reads it in production) does not satisfy that on its own: it is
// lost on every deploy/restart, and — unlike a real incident, which spans
// many server instances/invocations behind a load balancer — it is not
// even visible outside the single process that happened to record it.
// Every hit is now ALSO written as a structured log line via
// `emitConciergeValidatorLog`, which any real deployment's log
// aggregation (Vercel/CloudWatch/etc.) captures durably and makes
// queryable across every instance — without a DB connection, per the
// Hard Rules. `console.error` (not `.log`) so it is never filtered out of
// a production log level by default.
let validatorHitCount = 0;
const validatorHitReasons = new Map<string, number>();

/** Test seam — the real emitter is `console.error`; tests inject a spy
 *  instead of asserting against captured stdout. */
export type ConciergeValidatorLogEmitter = (line: string) => void;
let logEmitter: ConciergeValidatorLogEmitter = (line) => console.error(line);

/** Test-only injection point. */
export function setConciergeValidatorLogEmitter(emitter: ConciergeValidatorLogEmitter): void {
  logEmitter = emitter;
}

/** Test-only reset to the real console.error emitter. */
export function resetConciergeValidatorLogEmitter(): void {
  logEmitter = (line) => console.error(line);
}

function emitConciergeValidatorLog(reason: string): void {
  logEmitter(
    JSON.stringify({
      event: "concierge_output_validator_hit",
      reason,
      at: new Date().toISOString(),
    }),
  );
}

export function recordConciergeValidatorHit(reason: string): void {
  validatorHitCount += 1;
  validatorHitReasons.set(reason, (validatorHitReasons.get(reason) ?? 0) + 1);
  emitConciergeValidatorLog(reason);
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
