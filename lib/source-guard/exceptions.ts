/**
 * lib/source-guard/exceptions.ts — build-spec.md 2.8 (M3; consult item 8:
 * "Use exceptions only through an exact reviewed-copy wrapper or exact-
 * string/hash entry containing an ID, rationale, owner, and expiry. Fail
 * on unused or expired exceptions.").
 *
 * Every entry here is an EXACT string match (not a pattern) against the
 * literal runtime string text the AST guard found — a broader regex-based
 * allowlist is exactly what the consult rejected ("will become noisy and
 * ignored"). lib/__tests__/source-guard-ast.test.ts fails the whole suite
 * if:
 *   - an exception's `text` no longer matches anything the scan actually
 *     found (stale/unused — the underlying string was edited or removed,
 *     so the exception is dead weight), or
 *   - `expiresOn` has passed.
 *
 * Adding an entry here is a reviewed decision, not a bypass — it must name
 * a real owner and a real expiry date, not "never".
 */
export interface SourceGuardException {
  id: string;
  /** Exact runtime string text this exception covers — matched verbatim, not as a substring pattern. */
  text: string;
  rationale: string;
  owner: string;
  /** ISO date; the exception stops working after this date (test fails, forcing re-review). */
  expiresOn: string;
}

export const SOURCE_GUARD_EXCEPTIONS: SourceGuardException[] = [
  {
    id: "quiz-elective-pay-statute",
    text: "Which of these federal tax credits is NOT eligible for 'elective pay' (direct cash refund to tax-exempt entities)?",
    rationale:
      "Quotes the IRS elective-pay mechanism's own statutory eligibility rule for which CREDITS (not which reader/business) can be monetized via direct pay — a safe official-rule quiz context, exactly the build spec's own worked example of what a reviewed exception should cover. Not a claim about the reader's eligibility.",
    owner: "eligibility-claims-overhaul",
    expiresOn: "2027-02-13",
  },
  {
    id: "section-id-funded-version-unlocks",
    text: "what-a-funded-version-unlocks",
    rationale:
      "Internal stable section-id key (lib/report-engine.ts SECTION_IDS) used only for matching a report section across renders/persistence — never rendered to a user. The user-visible title for this section was reworded to 'What A Funded Version Adds'; the id itself was left unchanged to avoid any risk of breaking title-fallback matching for pre-id-field saved reports (see lib/report-engine.ts's own doc comment on section matching).",
    owner: "eligibility-claims-overhaul",
    expiresOn: "2027-02-13",
  },
  {
    id: "concierge-validator-reason-unlocks",
    text: "unlocks",
    rationale:
      "lib/concierge/output-validator.ts's internal telemetry `reason` id for the 'this unlocks' prohibited-pattern entry — a short diagnostic identifier, never shown to a user (the user-facing text on a hit is CONCIERGE_VALIDATOR_FALLBACK_MESSAGE, not this id).",
    owner: "eligibility-claims-overhaul",
    expiresOn: "2027-02-13",
  },
  {
    id: "concierge-validator-reason-verify-eligibility",
    text: "verify-eligibility",
    rationale:
      "lib/concierge/output-validator.ts's internal telemetry `reason` id for the 'verify eligibility' prohibited-pattern entry — a short diagnostic identifier, never shown to a user.",
    owner: "eligibility-claims-overhaul",
    expiresOn: "2027-02-13",
  },
];
