/**
 * review5 S6 — "quiz question 92 still says §48D 25% (only ID 22 was
 * fixed)." The pre-existing test (lib/__tests__/quiz-bank-extension-
 * facts.test.ts) only ever checked `QUIZ_QUESTIONS_EXTENSION.find((q) =>
 * q.id === 22)` — a single hand-picked ID — so a SECOND, independent
 * mention of the same stale fact at id 92 sat undetected for as long as
 * that test existed. This file replaces "check the ID I know about" with
 * "scan every item," per the coordinator's explicit instruction: "scan
 * EVERY quiz item + ALL rendered FAQ/Answers metadata/JSON-LD (not
 * selected IDs)."
 *
 * Three source arrays are scanned in full:
 *   - lib/quiz-data.ts's QUIZ_QUESTIONS (base bank + QUIZ_QUESTIONS_EXTENSION,
 *     already merged — this is the actual array the live quiz renders)
 *   - app/faq/page.tsx's FAQ_ITEMS (rendered on /faq; not JSON-LD'd, but
 *     "rendered FAQ" per the coordinator's own wording)
 *   - lib/answers-data.ts's ANSWER_PAGES (question/answer feed
 *     app/answers/[slug]/page.tsx's FAQPage JSON-LD verbatim via
 *     buildFaqJsonLd({question: a.question, answer: a.answer}); description
 *     feeds that page's meta description; bullets render on-page)
 *
 * KNOWN BOUNDARY, not silently skipped: app/programs/[slug]/page.tsx and
 * app/neighborhoods/[slug]/incentives/page.tsx also emit FAQPage JSON-LD,
 * but theirs is built at request time from catalog fields
 * (p.summary/p.benefits/p.howToApply, and dynamic org-name lists) rather
 * than a static hand-authored array importable here — scanning those would
 * mean scanning the full internal catalog's prose fields, a different
 * (and much larger) surface than "quiz + FAQ + Answers" copy. Not covered
 * by this file.
 */
import { describe, expect, it } from "vitest";
import { QUIZ_QUESTIONS } from "../quiz-data";
import { FAQ_ITEMS } from "@/app/faq/page";
import { ANSWER_PAGES } from "../answers-data";

// ── Shared detectors ────────────────────────────────────────────────────────

/** Any mention of the §48D CHIPS credit that asserts a rate OTHER than the
 *  single catalog-derived 35% (data/programs-internal.json's "chips48d"
 *  record) as a stated fact. Distractor choices in a multiple-choice list
 *  are exempt — those are supposed to be wrong; only prose (explanation,
 *  question, answer text) is checked. */
function has48dRateDrift(text: string): boolean {
  if (!/48D/.test(text)) return false;
  // No trailing \b after "%" — "%" (non-word) followed by a space
  // (non-word) is not a word-boundary transition, so \b there never
  // matches; "%" itself is an unambiguous enough right edge.
  const wrongRateNearby = /\b(20|25|30)%[^.!?]{0,60}48D|48D[^.!?]{0,60}\b(20|25|30)%/;
  return wrongRateNearby.test(text);
}

/** F11: an unauthorized paraphrase of the audit-banned "designed to
 *  combine with each other" claim. */
function hasDesignedToCombineClaim(text: string): boolean {
  return /designed to (work together|combine)/i.test(text);
}

/** F11: an UNCONDITIONAL combination claim — "can be combined with X" /
 *  "combines with X" with no verification caveat anywhere in the same
 *  string. A caveat word appearing SOMEWHERE in the text is treated as
 *  covering the claim (matches this codebase's existing style of one
 *  caveat per paragraph, not one per sentence — narrower than S4's
 *  per-sentence concierge check because this is authored copy reviewed as
 *  a whole, not an unbounded model response). */
function hasUnconditionalCombinationClaim(text: string): boolean {
  const combinationClaim = /\bcan be combined with\b|\bcombines with\b/i;
  if (!combinationClaim.test(text)) return false;
  const hasCaveat = /\bconfirm\b|\bverify\b|\bcheck\b|\bseparate\b|\bown\s+(?:combination\s+)?rules\b|\bdo not assume\b|\bworth comparing\b/i.test(
    text,
  );
  return !hasCaveat;
}

/** F8: a phrase implying the tool itself determines PRECISE/EXACT
 *  eligibility for the reader, rather than mapped location signals. */
function hasExactEligibilityClaim(text: string): boolean {
  return /\bexact eligibility\b|\bcheck your address eligibility\b/i.test(text);
}

function scanAll(
  label: string,
  items: readonly { id: number | string; texts: string[] }[],
) {
  const drift: string[] = [];
  const designed: string[] = [];
  const unconditional: string[] = [];
  const exact: string[] = [];

  for (const { id, texts } of items) {
    for (const text of texts) {
      if (has48dRateDrift(text)) drift.push(`${label} ${id}: ${text}`);
      if (hasDesignedToCombineClaim(text)) designed.push(`${label} ${id}: ${text}`);
      if (hasUnconditionalCombinationClaim(text)) unconditional.push(`${label} ${id}: ${text}`);
      if (hasExactEligibilityClaim(text)) exact.push(`${label} ${id}: ${text}`);
    }
  }

  return { drift, designed, unconditional, exact };
}

// ── Self-tests: prove the detectors actually catch the pre-fix shapes ──────

describe("S6 detectors — adversarial self-test (not vacuously passing)", () => {
  it("has48dRateDrift catches the exact pre-fix id-92 shape and passes the corrected 35% shape", () => {
    expect(has48dRateDrift("§48D (25% chip credit) is a real federal program.")).toBe(true);
    expect(has48dRateDrift("§48D (35% chip credit) is a real federal program.")).toBe(false);
    expect(has48dRateDrift("§48D and §30C are both elective-pay eligible.")).toBe(false);
  });

  it("hasDesignedToCombineClaim catches the exact pre-fix bullet-562 shape", () => {
    expect(
      hasDesignedToCombineClaim("some are designed to work together, others are not"),
    ).toBe(true);
    expect(hasDesignedToCombineClaim("each has its own separate combination rules")).toBe(false);
  });

  it("hasUnconditionalCombinationClaim catches the exact pre-fix faq-page-87 shape and passes a caveated equivalent", () => {
    expect(
      hasUnconditionalCombinationClaim(
        "It can be combined with Historic Tax Credits and Opportunity Zone benefits.",
      ),
    ).toBe(true);
    expect(
      hasUnconditionalCombinationClaim(
        "Historic Tax Credits and Opportunity Zone benefits are worth comparing, but confirm before assuming they combine.",
      ),
    ).toBe(false);
  });

  it("hasExactEligibilityClaim catches both named F8 phrases", () => {
    expect(hasExactEligibilityClaim("so exact eligibility always depends on the address")).toBe(true);
    expect(hasExactEligibilityClaim("Learn how it works and check your address eligibility.")).toBe(true);
    expect(hasExactEligibilityClaim("check whether your address sits in an eligible tract")).toBe(false);
  });
});

// ── Full-population scans ────────────────────────────────────────────────────

describe("QUIZ_QUESTIONS — full scan, every item, not selected IDs (review5 S6)", () => {
  it("scans a non-trivial number of quiz items (the scan is not silently a no-op)", () => {
    expect(QUIZ_QUESTIONS.length).toBeGreaterThan(50);
  });

  it("no quiz item states a §48D rate other than 35%, no 'designed to combine' claim, no unconditional combination claim, no exact-eligibility claim — checked across question + choices + explanation", () => {
    const items = QUIZ_QUESTIONS.map((q) => ({
      id: q.id,
      texts: [q.question, q.explanation, ...q.choices],
    }));
    const { drift, designed, unconditional, exact } = scanAll("quiz id", items);

    expect(drift, drift.join("\n")).toEqual([]);
    expect(designed, designed.join("\n")).toEqual([]);
    expect(unconditional, unconditional.join("\n")).toEqual([]);
    expect(exact, exact.join("\n")).toEqual([]);
  });

  it("every §48D mention that includes a rate states 35% specifically — positive assertion, not just absence of the wrong number", () => {
    const mentionsWithRate = QUIZ_QUESTIONS.filter(
      (q) => /48D/.test(q.explanation) && /\d{2}%/.test(q.explanation),
    );
    expect(mentionsWithRate.length).toBeGreaterThan(0);
    for (const q of mentionsWithRate) {
      expect(q.explanation, `quiz id ${q.id}`).toContain("35%");
    }
  });
});

describe("FAQ_ITEMS — full scan, every item (review5 S6)", () => {
  it("scans a non-trivial number of FAQ items", () => {
    expect(FAQ_ITEMS.length).toBeGreaterThan(5);
  });

  it("no FAQ item has a §48D rate drift, 'designed to combine' claim, unconditional combination claim, or exact-eligibility claim", () => {
    const items = FAQ_ITEMS.map((f, i) => ({ id: i, texts: [f.q, f.a] }));
    const { drift, designed, unconditional, exact } = scanAll("FAQ index", items);

    expect(drift, drift.join("\n")).toEqual([]);
    expect(designed, designed.join("\n")).toEqual([]);
    expect(unconditional, unconditional.join("\n")).toEqual([]);
    expect(exact, exact.join("\n")).toEqual([]);
  });
});

describe("ANSWER_PAGES — full scan, every page, every rendered field (review5 S6)", () => {
  it("scans a non-trivial number of Answers pages", () => {
    expect(ANSWER_PAGES.length).toBeGreaterThan(5);
  });

  it("no Answers page has a §48D rate drift, 'designed to combine' claim, unconditional combination claim, or exact-eligibility claim — across description, answer, AND bullets (description/answer feed the page's JSON-LD and metadata; bullets render on-page)", () => {
    const items = ANSWER_PAGES.map((a) => ({
      id: a.slug,
      texts: [a.description, a.answer, ...a.bullets],
    }));
    const { drift, designed, unconditional, exact } = scanAll("answers slug", items);

    expect(drift, drift.join("\n")).toEqual([]);
    expect(designed, designed.join("\n")).toEqual([]);
    expect(unconditional, unconditional.join("\n")).toEqual([]);
    expect(exact, exact.join("\n")).toEqual([]);
  });

  it("the exact JSON-LD payload app/answers/[slug]/page.tsx emits (question + answer only) is independently clean for every page — not just the source array", () => {
    // Mirrors buildFaqJsonLd's actual mainEntity shape (lib/seo.ts) so this
    // assertion tracks what a search engine actually indexes, not an
    // assumption about it.
    for (const a of ANSWER_PAGES) {
      const jsonLdEntity = {
        "@type": "Question",
        name: a.question,
        acceptedAnswer: { "@type": "Answer", text: a.answer },
      };
      const serialized = JSON.stringify(jsonLdEntity);
      expect(has48dRateDrift(serialized), a.slug).toBe(false);
      expect(hasDesignedToCombineClaim(serialized), a.slug).toBe(false);
      expect(hasUnconditionalCombinationClaim(serialized), a.slug).toBe(false);
      expect(hasExactEligibilityClaim(serialized), a.slug).toBe(false);
    }
  });
});
