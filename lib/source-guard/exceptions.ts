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
 * was reviewed in (`filePath`) and a human-readable AST-location
 * description (`context`) the reviewer actually checked, plus a
 * `textHash` — a SHA-256 of `text`, stored as an independent hex-string
 * LITERAL (not computed from `text` in this same file — that would give
 * zero tamper-evidence, since editing `text` and its co-located hash call
 * is the same edit) and re-verified against `text` at test time — so a
 * stealth edit to `text` (widening or changing what string is being
 * excepted, without recomputing and updating the committed hash) fails
 * the suite instead of silently taking effect.
 * lib/__tests__/source-guard-ast.test.ts's real-codebase scan now only
 * treats a violation as excepted when its `text` AND `filePath` both
 * match an active, non-expired, hash-verified entry — file path is no
 * longer optional context, it's part of the match key.
 *
 * lib/__tests__/source-guard-ast.test.ts fails the whole suite if:
 *   - an exception's `text` no longer matches anything the scan actually
 *     found AT THAT EXACT `filePath` (stale/unused — the underlying
 *     string was edited, moved, or removed, so the exception is dead
 *     weight or, worse, silently protecting a DIFFERENT file it was
 *     never reviewed for), or
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
  /** Human-readable AST location the reviewer actually checked (e.g. which object/property this string is the value of). */
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
    context: "QUIZ_QUESTIONS_EXTENSION array entry's `question` property value (quiz id 94).",
    rationale:
      "Quotes the IRS elective-pay mechanism's own statutory eligibility rule for which CREDITS (not which reader/business) can be monetized via direct pay — a safe official-rule quiz context, exactly the build spec's own worked example of what a reviewed exception should cover. Not a claim about the reader's eligibility. REVIEW5 S8 CORRECTION: this text IS rendered to the user — it is the literal quiz question text shown on screen. It is excepted because it is a REVIEWED, user-facing, verbatim statutory quote (the doctrine's own worked example), not because it is hidden from users. An earlier version of this codebase's own acceptance doc incorrectly claimed all four exceptions were 'none rendered to a user' — that claim was false for this one and has been corrected.",
    owner: "eligibility-claims-overhaul",
    expiresOn: "2027-02-13",
  },
  {
    id: "section-id-funded-version-unlocks",
    text: "what-a-funded-version-unlocks",
    textHash: "84890f9fb11ef64b47d16284b07e4f92986eab95c5b671d47fabb4584675cc1e",
    filePath: "lib/report-engine.ts",
    context: "SECTION_IDS object literal's `whatAFundedVersionUnlocks` property value.",
    rationale:
      "Internal stable section-id key (lib/report-engine.ts SECTION_IDS) used only for matching a report section across renders/persistence — never rendered to a user. The user-visible title for this section was reworded to 'What A Funded Version Adds'; the id itself was left unchanged to avoid any risk of breaking title-fallback matching for pre-id-field saved reports (see lib/report-engine.ts's own doc comment on section matching).",
    owner: "eligibility-claims-overhaul",
    expiresOn: "2027-02-13",
  },
  {
    id: "concierge-validator-reason-unlocks",
    text: "unlocks",
    textHash: "6bc2876613dc4e07605be0e2e87fe4b49dfcdf67867f38c174e14e4e838249d9",
    filePath: "lib/concierge/output-validator.ts",
    context: "PROHIBITED_PATTERNS array entry's `reason` property value, for the 'this unlocks' pattern.",
    rationale:
      "lib/concierge/output-validator.ts's internal telemetry `reason` id for the 'this unlocks' prohibited-pattern entry — a short diagnostic identifier, never shown to a user (the user-facing text on a hit is CONCIERGE_VALIDATOR_FALLBACK_MESSAGE, not this id). Scoped to this exact file (review5 S8): the bare word \"unlocks\" is short and generic enough that an unrelated NEW component could contain the identical literal for an unrelated reason — this exception must never silently cover that other file too.",
    owner: "eligibility-claims-overhaul",
    expiresOn: "2027-02-13",
  },
  {
    id: "concierge-validator-reason-verify-eligibility",
    text: "verify-eligibility",
    textHash: "bcfdfbbe0acb3136d5b73ba593f8498eacbcbe58c770589e91136d9536bb28f4",
    filePath: "lib/concierge/output-validator.ts",
    context: "PROHIBITED_PATTERNS array entry's `reason` property value, for the 'verify eligibility' pattern.",
    rationale:
      "lib/concierge/output-validator.ts's internal telemetry `reason` id for the 'verify eligibility' prohibited-pattern entry — a short diagnostic identifier, never shown to a user. Scoped to this exact file (review5 S8) for the same reason as concierge-validator-reason-unlocks above.",
    owner: "eligibility-claims-overhaul",
    expiresOn: "2027-02-13",
  },
];

/**
 * review5 S8 — the actual match predicate a violation must satisfy to be
 * treated as excepted: exact `text`, AND exact `filePath` (resolved
 * relative to `rootDir`, since violations carry an absolute path from
 * ts-morph and exceptions are authored as repo-relative paths), AND not
 * expired. Exported so the "identical literal in a NEW component fails"
 * property can be tested directly against this real predicate, not a
 * re-implementation of it.
 */
export function isViolationExcepted(
  violation: { text: string; filePath: string },
  exceptions: readonly SourceGuardException[],
  rootDir: string,
  now: number = Date.now(),
): boolean {
  return exceptions.some((exception) => {
    if (exception.text !== violation.text) return false;
    if (new Date(exception.expiresOn).getTime() <= now) return false;
    const violationRelativePath = violation.filePath.startsWith(rootDir)
      ? violation.filePath.slice(rootDir.length).replace(/^[/\\]/, "")
      : violation.filePath;
    return violationRelativePath === exception.filePath;
  });
}
