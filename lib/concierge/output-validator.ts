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
const PROHIBITED_PATTERNS: { pattern: RegExp; reason: string; perSentence?: boolean }[] = [
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
  // review6 S14: "cannot"/"can't"/"won't" added alongside the original
  // "will not"/"never"; "be accepted" added alongside "receive"/"be
  // approved". "qualify" REMOVED from this outcome list — "cannot/does
  // not qualify" is now its own dedicated family below, so the two don't
  // silently overlap under one reason string.
  { pattern: /\byou\s+(?:will\s+(?:not|never)|won'?t|cannot|can'?t)\s+(?:receive|be\s+approved|be\s+accepted)\b/i, reason: "you-will-not-receive" },
  { pattern: /\byou'?ve?\s+been\s+(?:denied|rejected)\b/i, reason: "denied-claim" },
  // review6 S14 (HIGH): six named grammar families the S4 pass didn't
  // cover, each still scoped to a determination ABOUT THE READER (or the
  // reader's own submission) — "you"/"your business"/"your
  // application"/"your project" as subject — never a bare "requires"/
  // "qualify"/"fails" anywhere in the text. That scoping is deliberate:
  // it's exactly what keeps a genuinely informational sentence like "the
  // program requires a minimum investment" or "some applicants do not
  // qualify" (neither one a claim about THIS reader) from tripping any
  // of these.
  //
  // "not qualified" — adjectival ("you're not qualified"), a distinct
  // grammatical form from the verb phrase "do/does not qualify" above; a
  // model can produce either for the same underlying claim.
  { pattern: /\byou(?:'re| are)\s+not\s+qualified\b/i, reason: "you-not-qualified" },
  { pattern: /\byour\s+business\s+(?:is\s+)?not\s+qualified\b/i, reason: "business-not-qualified" },
  // "does not/cannot qualify" — the modal ("cannot"/"can't") forms S4's
  // "do not"/"don't" pair didn't cover, plus the currently-uncovered
  // "your business" subject for this verb (S4 only had it for
  // eligible/ineligible, not qualify).
  { pattern: /\byou\s+cannot\s+qualify\b/i, reason: "you-cannot-qualify" },
  { pattern: /\byou\s+can'?t\s+qualify\b/i, reason: "you-cannot-qualify" },
  { pattern: /\byour\s+business\s+(?:does\s+not|doesn'?t|cannot|can'?t)\s+qualify\b/i, reason: "business-does-not-qualify" },
  // review7 S19(a) (HIGH): review6 S14 removed "qualify" from the
  // "will not/never receive/be approved/be accepted" pattern below (its
  // doc comment there explicitly said so), on the stated assumption that
  // "cannot/does not qualify" — added immediately above — would cover
  // the modal ground it gave up. That assumption was wrong: the FUTURE-
  // TENSE and contraction forms of "qualify" — "you will not qualify",
  // "you will never qualify", "you won't qualify" — were never covered
  // by EITHER family (the "cannot"/"can't" family above is modal, not
  // future-tense; the S4-era "do not"/"don't" family is present-tense).
  // A phrase this validator caught before S14 stopped being caught
  // after it — restored here as its own explicit family so it can never
  // again be assumed-covered-elsewhere without a test proving it.
  { pattern: /\byou\s+will\s+(?:not|never)\s+qualify\b/i, reason: "you-will-not-qualify" },
  { pattern: /\byou\s+won'?t\s+qualify\b/i, reason: "you-will-not-qualify" },
  // "appears ineligible" — the negative mirror of the existing
  // POSITIVE-only "appears eligible" entry above (review5 S4 hard-reject).
  { pattern: /\bappears?\s+(?:to\s+be\s+)?(?:not\s+eligible|ineligible)\b/i, reason: "appears-ineligible" },
  // "fails requirements".
  { pattern: /\byou\s+fails?\s+(?:to\s+meet\s+)?(?:the\s+)?requirements\b/i, reason: "fails-requirements" },
  { pattern: /\byour\s+(?:application|business|project)\s+fails?\s+(?:to\s+meet\s+)?(?:the\s+)?requirements\b/i, reason: "fails-requirements" },
  // "cannot/will not receive/be approved/be accepted" — passive tense
  // expansion of the existing "you've been denied/rejected" entry above
  // (present-perfect only); a model can just as easily produce simple
  // past/present/future passive for the same claim.
  { pattern: /\byou\s+(?:were|are|will\s+be)\s+(?:denied|rejected)\b/i, reason: "denied-claim" },
  // "application/project denied" — a determination about the READER'S
  // SUBMISSION specifically, distinct from "you've been denied" (about
  // the reader personally) above. Passive, across the four tenses a
  // model might reasonably produce. "your X" has no article ambiguity —
  // always a reader claim, safe as a plain regex here.
  { pattern: /\byour\s+(?:application|project|request)\s+(?:was|is|has\s+been|will\s+be)\s+(?:denied|rejected)\b/i, reason: "application-denied" },
  // "the application/project/request was denied" (a DEFINITE article,
  // not "your") — same reason string as the entry above; kept as its
  // own regex only because the article differs.
  //
  // review10 S29/S30/S31 (coordinator's binding design ruling, replacing
  // review7 S19(b) through review9 S28): this used to carry a
  // "reported-speech exemption" — skip the violation if a marker verb
  // like "said"/"reports"/"notes" appeared earlier in the sentence, on
  // the theory that "the application" (no "your") is ambiguous between
  // the reader's own submission and a third party's, relayed in reported
  // speech ("Jane said the application was denied last cycle").
  //
  // Three consecutive review rounds (S19(b) → S25 → S28 → S29/S30/S31)
  // each closed one bypass shape in that exemption's grammar and a new
  // one was found the very next round: missing present-tense verb
  // inflections (S25), missing subject-awareness letting first-party/
  // product-owned sources and imperative constructions through (S28),
  // then first-person "I heard", multi-word product-owned subjects
  // across punctuation, and "according to our records" (S29/S30), while
  // the subject-scoping fix ITSELF newly broke genuine nested third-
  // party attribution ("We note that the city clerk reported the
  // application was denied" — S31). A regex grammar of English
  // attribution can always be evaded; three rounds of whack-a-mole
  // proved it empirically rather than hypothetically.
  //
  // The coordinator's binding ruling: DELETE the exemption. Every
  // occurrence of this phrase — regardless of framing, subject, or
  // reported-speech context — is now an unconditional hit, exactly like
  // every other entry in this array. Rationale (also recorded in
  // docs/eligibility-claims-acceptance.md):
  //   1. The failure modes are asymmetric. Over-blocking costs one
  //      deterministic-fallback answer in place of a legitimate
  //      informational sentence; under-blocking leaks a legal-adjacent
  //      determination about an application's outcome. Given a choice
  //      between an occasional unnecessary fallback and a real leak,
  //      the fallback is always the cheaper failure.
  //   2. The assistant has no legitimate need to assert "the application
  //      was denied" in ANY framing. Program guidance never requires
  //      stating a specific application's outcome, third-party or
  //      otherwise — a genuinely informational answer can convey the
  //      same substance without tripping this phrase family at all.
  //   3. No exemption grammar has survived contact with adversarial
  //      review. Every carve-out this file has ever added for this
  //      family has been bypassed within one to two review rounds.
  //      Removing the carve-out removes the bypass surface entirely.
  // S32/S33/S34 escalation ended in a second coordinator ruling: syntactic
  // enumeration (passive, adjectival, nominal, possessive, compound,
  // reduced-relative, progressive, plural...) provably does not converge —
  // three consecutive review rounds each produced new escapes. The family
  // is therefore defined by sentence-level CO-OCCURRENCE, not shape: any
  // sentence containing both a family noun (application/project/request,
  // any inflection or possessive) and a denial-family word (deny/denial/
  // rejected/rejection, any inflection) is an unconditional hit. There is
  // no morphology left to enumerate. Over-match (e.g. "denial of service
  // requests") is the accepted default-deny cost per the Round-9 ruling.
  { pattern: /(?=[\s\S]*\b(?:applications?|projects?|requests?)(?:['’]s?)?\b)(?=[\s\S]*(?:\b(?:den(?:y|ies|ied|ying|ial|ials)|reject(?:s|ed|ing|ion|ions)?|declin(?:e|es|ed|ing)|refus(?:e|es|ed|ing|al|als)|unsuccessful)\b|\bturn(?:s|ed|ing)?\b[^.!?\n]*?\bdown\b|\b(?:not|never)\b[^.!?\n]*?\bapproved\b|n['’]t\b[^.!?\n]*?\bapproved\b))/i, reason: "application-denied", perSentence: true },
];

/** Naive sentence splitter — good enough for a prose model response, not a
 *  general-purpose NLP tool. Splits on '.', '!', '?' followed by
 *  whitespace, and on hard newlines (a model's own paragraph/list breaks),
 *  so a multi-paragraph answer is checked paragraph-by-paragraph and
 *  sentence-by-sentence within each. */
/**
 * review15 S37: conservative splitter for the perSentence co-occurrence
 * check ONLY. The naive splitter can cut ONE determination sentence into
 * two fragments (after "U.S.", "e.g.", or a colon-then-newline), and a
 * false SPLIT here is a false PASS — the opposite of the default-deny
 * bias. This splitter joins ambiguous boundaries instead: a newline only
 * ends a sentence when the previous line ends with terminal punctuation,
 * and a period preceded by a known abbreviation (or a single capital
 * letter) does not split. Over-joining can only over-block, which the
 * S29–S34 rulings accept; under-splitting-in-reverse (a false pass)
 * cannot happen from joining. The authority-routing check keeps the
 * naive splitter — its semantics are settled and reviewed.
 */
function splitIntoSentencesConservative(text: string): string[] {
  const ABBREV_END =
    /(?:\b(?:U\.S|U\.S\.A|e\.g|i\.e|etc|vs|Inc|Corp|Dept|No|Nos|approx|St|Ave|Dr|Mr|Mrs|Ms)\.|\b[A-Z]\.)$/;
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const blocks: string[] = [];
  for (const line of lines) {
    const prev = blocks[blocks.length - 1];
    // review16 S40: a line ending in a known abbreviation has NOT ended its
    // sentence, even though it ends with a period — join across the newline.
    if (prev !== undefined && (!/[.!?]$/.test(prev) || ABBREV_END.test(prev))) {
      blocks[blocks.length - 1] = `${prev} ${line}`;
    } else {
      blocks.push(line);
    }
  }
  const out: string[] = [];
  for (const block of blocks) {
    const fragments: string[] = [];
    for (const part of block.split(/(?<=[.!?])\s+/)) {
      const prev = fragments[fragments.length - 1];
      if (prev !== undefined && ABBREV_END.test(prev)) {
        fragments[fragments.length - 1] = `${prev} ${part}`;
      } else {
        fragments.push(part);
      }
    }
    out.push(...fragments);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

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
  // fallback, never a patch-up. This now includes BOTH the "your X was
  // denied" and "the X was denied" application-denied families — see
  // the review10 S29/S30/S31 comment above the latter entry for why the
  // definite-article form no longer carries a reported-speech exemption.
  // review14 S35: co-occurrence patterns are sentence-scoped — "your
  // application" in one sentence and an unrelated "denied" in another must
  // not trip. Word-local patterns keep whole-text matching.
  const sentences = splitIntoSentencesConservative(rawText);
  for (const { pattern, reason, perSentence } of PROHIBITED_PATTERNS) {
    const hit = perSentence
      ? sentences.some((s) => pattern.test(s))
      : pattern.test(rawText);
    if (hit) {
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
