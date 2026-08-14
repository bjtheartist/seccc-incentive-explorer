/**
 * lib/source-guard/exceptions.ts — build-spec.md 2.8 (M3; consult item 8:
 * "Use exceptions only through an exact reviewed-copy wrapper or exact-
 * string/hash entry containing an ID, rationale, owner, and expiry. Fail
 * on unused or expired exceptions.").
 *
 * review5 S8: exact TEXT matching alone was not enough. A short, generic
 * reason-id string like "unlocks" or "verify-eligibility" — exactly what
 * lib/concierge/output-validator.ts uses as its internal telemetry
 * `reason` values — is exactly the shape of literal a totally unrelated
 * NEW component could also happen to contain (a bare-word constant, an
 * enum value, anything). Because the old matching was `text === entry`
 * with no other constraint, one reviewed exception for "unlocks" in
 * output-validator.ts silently became a GLOBAL pass for the literal
 * string "unlocks" anywhere in the entire scanned codebase — a violation
 * in a brand-new, never-reviewed file with that exact literal would sail
 * through unflagged. Every exception is now bound to the EXACT file it
 * was reviewed in (`filePath`), plus a `textHash` — a SHA-256 of `text`,
 * stored as an independent hex-string LITERAL (not computed from `text`
 * in this same file — that would give zero tamper-evidence, since editing
 * `text` and its co-located hash call is the same edit) and re-verified
 * against `text` at test time — so a stealth edit to `text` (widening or
 * changing what string is being excepted, without recomputing and
 * updating the committed hash) fails the suite instead of silently taking
 * effect.
 *
 * review6 S15 (MEDIUM): `filePath` alone still wasn't enough — S8's own
 * fix left one gap it explicitly flagged as future work: the SAME literal
 * recurring at a DIFFERENT position WITHIN the reviewed file (a different
 * object property, a different array element) was still silently covered
 * by one exception reviewed for a completely different occurrence. Every
 * exception now ALSO carries `context` — a stable AST-location
 * FINGERPRINT (`lib/source-guard/scan.ts`'s `computeAstContextFingerprint`,
 * e.g. `"PROHIBITED_PATTERNS[10].reason"`), PRE-COMPUTED by running the
 * real scan against the reviewed occurrence and pasted here as a literal,
 * the same tamper-evidence treatment `textHash` already got. It is
 * matched EXACTLY against the fingerprint the scanner computes for each
 * real violation — not freeform reviewer prose (an earlier design of this
 * field held human-readable location prose instead; that prose is now
 * folded into `rationale`, since it can no longer double as the machine
 * match key without becoming exactly the fingerprint string itself).
 * lib/__tests__/source-guard-ast.test.ts's real-codebase scan now only
 * treats a violation as excepted when its `text`, `filePath`, AND
 * `context` fingerprint ALL match an active, non-expired, hash-verified
 * entry.
 *
 * lib/__tests__/source-guard-ast.test.ts fails the whole suite if:
 *   - an exception's `text` no longer matches anything the scan actually
 *     found AT THAT EXACT `filePath` AND `context` fingerprint
 *     (stale/unused — the underlying string was edited, moved, or
 *     removed, so the exception is dead weight or, worse, silently
 *     protecting a DIFFERENT occurrence it was never reviewed for), or
 *   - `expiresOn` has passed, or
 *   - `textHash` does not match `sha256(text)` (the reviewed text was
 *     altered without a fresh review).
 *
 * Adding an entry here is a reviewed decision, not a bypass — it must name
 * a real owner and a real expiry date, not "never".
 */
export interface SourceGuardException {
  id: string;
  /** Exact runtime string text this exception covers — matched verbatim, not as a substring pattern. */
  text: string;
  /** SHA-256 hex digest of `text`, PRE-COMPUTED and stored as a literal (not derived from `text` in this file) — see this module's doc comment. Verified against `text` in lib/__tests__/source-guard-ast.test.ts. */
  textHash: string;
  /** Exact repo-relative path this exception is scoped to — a matching `text` found at any OTHER path is NOT excepted. */
  filePath: string;
  /**
   * review6 S15: a stable AST-location FINGERPRINT (not freeform prose —
   * see this module's doc comment), PRE-COMPUTED by running the real
   * scan against the exact reviewed occurrence
   * (`lib/source-guard/scan.ts`'s `computeAstContextFingerprint`) and
   * pasted here as a literal. Matched EXACTLY against
   * `SourceGuardViolation.context` — a matching `text`+`filePath` at a
   * DIFFERENT position within that same file (different property,
   * different array element) produces a different fingerprint and is
   * NOT excepted.
   */
  context: string;
  rationale: string;
  owner: string;
  /** ISO date; the exception stops working after this date (test fails, forcing re-review). */
  expiresOn: string;
}

export const SOURCE_GUARD_EXCEPTIONS: SourceGuardException[] = [
  {
    id: "quiz-elective-pay-statute",
    text: "Which of these federal tax credits is NOT eligible for 'elective pay' (direct cash refund to tax-exempt entities)?",
    textHash: "582db8df6f47208cab6bfc8bd0c76372767a2c74f0e7888119c8377fa1261966",
    filePath: "lib/quiz-bank-extension.ts",
    // review6 S15: real computed fingerprint (array index 83, this
    // codebase's own quiz id 94 for this question — the two numbering
    // schemes differ; the fingerprint uses the AST's own array position,
    // not the quiz bank's separate semantic id field).
    context: "QUIZ_QUESTIONS_EXTENSION[83].question",
    rationale:
      "Location: QUIZ_QUESTIONS_EXTENSION array entry's `question` property value (quiz id 94). Quotes the IRS elective-pay mechanism's own statutory eligibility rule for which CREDITS (not which reader/business) can be monetized via direct pay — a safe official-rule quiz context, exactly the build spec's own worked example of what a reviewed exception should cover. Not a claim about the reader's eligibility. REVIEW5 S8 CORRECTION: this text IS rendered to the user — it is the literal quiz question text shown on screen. It is excepted because it is a REVIEWED, user-facing, verbatim statutory quote (the doctrine's own worked example), not because it is hidden from users. An earlier version of this codebase's own acceptance doc incorrectly claimed all four exceptions were 'none rendered to a user' — that claim was false for this one and has been corrected.",
    owner: "eligibility-claims-overhaul",
    expiresOn: "2027-02-13",
  },
  {
    id: "section-id-funded-version-unlocks",
    text: "what-a-funded-version-unlocks",
    textHash: "84890f9fb11ef64b47d16284b07e4f92986eab95c5b671d47fabb4584675cc1e",
    filePath: "lib/report-engine.ts",
    context: "SECTION_IDS.whatAFundedVersionUnlocks",
    rationale:
      "Location: SECTION_IDS object literal's `whatAFundedVersionUnlocks` property value. Internal stable section-id key (lib/report-engine.ts SECTION_IDS) used only for matching a report section across renders/persistence — never rendered to a user. The user-visible title for this section was reworded to 'What A Funded Version Adds'; the id itself was left unchanged to avoid any risk of breaking title-fallback matching for pre-id-field saved reports (see lib/report-engine.ts's own doc comment on section matching).",
    owner: "eligibility-claims-overhaul",
    expiresOn: "2027-02-13",
  },
  {
    id: "concierge-validator-reason-unlocks",
    text: "unlocks",
    textHash: "6bc2876613dc4e07605be0e2e87fe4b49dfcdf67867f38c174e14e4e838249d9",
    filePath: "lib/concierge/output-validator.ts",
    // review6 S15: real computed fingerprint. Array index 10 — see
    // lib/concierge/output-validator.ts's own current PROHIBITED_PATTERNS
    // ordering; this exception is bound to THIS exact array position, not
    // just the reason string, so an unrelated new entry elsewhere in that
    // same array with the same-shaped text would NOT be silently covered.
    context: "PROHIBITED_PATTERNS[10].reason",
    rationale:
      "Location: PROHIBITED_PATTERNS array entry's `reason` property value, for the 'this unlocks' pattern. lib/concierge/output-validator.ts's internal telemetry `reason` id for the 'this unlocks' prohibited-pattern entry — a short diagnostic identifier, never shown to a user (the user-facing text on a hit is CONCIERGE_VALIDATOR_FALLBACK_MESSAGE, not this id). Scoped to this exact file AND array position (review5 S8 + review6 S15): the bare word \"unlocks\" is short and generic enough that an unrelated NEW component (or a different entry in this SAME array) could contain the identical literal for an unrelated reason — this exception must never silently cover either.",
    owner: "eligibility-claims-overhaul",
    expiresOn: "2027-02-13",
  },
  {
    id: "concierge-validator-reason-verify-eligibility",
    text: "verify-eligibility",
    textHash: "bcfdfbbe0acb3136d5b73ba593f8498eacbcbe58c770589e91136d9536bb28f4",
    filePath: "lib/concierge/output-validator.ts",
    context: "PROHIBITED_PATTERNS[11].reason",
    rationale:
      "Location: PROHIBITED_PATTERNS array entry's `reason` property value, for the 'verify eligibility' pattern. lib/concierge/output-validator.ts's internal telemetry `reason` id for the 'verify eligibility' prohibited-pattern entry — a short diagnostic identifier, never shown to a user. Scoped to this exact file and array position (review5 S8 + review6 S15) for the same reason as concierge-validator-reason-unlocks above.",
    owner: "eligibility-claims-overhaul",
    expiresOn: "2027-02-13",
  },
];

/**
 * review5 S8 / review6 S15 — the actual match predicate a violation must
 * satisfy to be treated as excepted: exact `text`, AND exact `filePath`
 * (resolved relative to `rootDir`, since violations carry an absolute
 * path from ts-morph and exceptions are authored as repo-relative
 * paths), AND exact `context` (the AST-location fingerprint — S15: the
 * SAME literal recurring at a DIFFERENT position in that same file is
 * NOT excepted), AND exact `textHash` (S15: belt-and-suspenders against
 * a stale/tampered hash on the exception entry itself — logically
 * implied by `text` matching since the hash is a pure function of the
 * text, but checked explicitly anyway per the coordinator's directive,
 * and it DOES catch the specific case of `exception.textHash` being
 * hand-edited out of sync with `exception.text`), AND not expired.
 * Exported so the "identical literal in a NEW component fails" and
 * "identical literal elsewhere in the SAME file fails" properties can be
 * tested directly against this real predicate, not a re-implementation
 * of it.
 */
export function isViolationExcepted(
  violation: { text: string; filePath: string; context: string; textHash: string },
  exceptions: readonly SourceGuardException[],
  rootDir: string,
  now: number = Date.now(),
): boolean {
  return exceptions.some((exception) => {
    if (exception.text !== violation.text) return false;
    if (exception.context !== violation.context) return false;
    if (exception.textHash !== violation.textHash) return false;
    if (new Date(exception.expiresOn).getTime() <= now) return false;
    const violationRelativePath = violation.filePath.startsWith(rootDir)
      ? violation.filePath.slice(rootDir.length).replace(/^[/\\]/, "")
      : violation.filePath;
    return violationRelativePath === exception.filePath;
  });
}
