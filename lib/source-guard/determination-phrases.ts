/**
 * lib/source-guard/determination-phrases.ts — build-spec.md 2.8 (M3 source
 * guard; consult item 8).
 *
 * The exact phrase list from the build spec. Matched against RUNTIME
 * STRING TEXT only (see lib/__tests__/source-guard-ast.test.ts for what
 * counts) — never comments or identifiers, and never the reviewed
 * exceptions file itself.
 */
export interface DeterminationPhrasePattern {
  id: string;
  pattern: RegExp;
}

export const DETERMINATION_PHRASE_PATTERNS: DeterminationPhrasePattern[] = [
  { id: "qualifies-for", pattern: /\bqualifies for\b/i },
  { id: "you-qualify", pattern: /\byou qualify\b/i },
  { id: "already-qualifies", pattern: /\balready qualifies\b/i },
  // "eligible for" in claim position — a bare statement that something IS
  // eligible for something, not a question about eligibility rules. The
  // build spec's own worked example (a quiz question quoting statute,
  // "eligible for elective pay") is exactly the kind of safe context that
  // needs a reviewed exception rather than a broader/weaker regex here.
  { id: "eligible-for", pattern: /\beligible for\b/i },
  { id: "unlocks", pattern: /\bunlocks?\b/i },
  { id: "ready-to-apply", pattern: /\bready to apply\b/i },
  { id: "verify-eligibility", pattern: /\bverify\b[^.!?]{0,40}\beligibility\b/i },
];

/** True if any determination phrase pattern matches the given text. */
export function findDeterminationPhraseMatch(text: string): DeterminationPhrasePattern | null {
  for (const entry of DETERMINATION_PHRASE_PATTERNS) {
    if (entry.pattern.test(text)) return entry;
  }
  return null;
}
