/**
 * Stage handoff — a compact, forwardable summary of where a user is in
 * their journey, built to hand to a chamber navigator or support
 * organization.
 *
 * WHY THIS EXISTS
 * ---------------
 * The report's existing share action copies a link to the full,
 * data-heavy report. A navigator receiving that link has to reconstruct
 * the user's actual question from twenty sections. This module produces
 * the opposite artifact: the address, the business intent, the stage the
 * user says they are in, the unresolved question in their own words, and
 * the official links a helper would need — nothing else. Intent in,
 * engagement out.
 *
 * PRODUCT BOUNDARY
 * ----------------
 * The handoff describes what is published and what is unresolved. It
 * never states that a use is permitted, prohibited, or eligible —
 * eligibility and use determinations belong to the administering
 * agencies. Copy in this module is written so the recipient reads an
 * open question, not a conclusion.
 *
 * Scoped to the ZONING stage first, deliberately: prove the mechanism on
 * one stage before extending. The type widens when other stages ship.
 */

export type HandoffStage = "zoning";

export interface StageHandoffLink {
  label: string;
  url: string;
}

export interface ZoningHandoffInput {
  address?: string | null;
  /** Business type / industry as the user described it. */
  businessType?: string | null;
  /** Published zoning designation, verbatim (e.g. "B3-2"). */
  zoneClass?: string | null;
  /** The activity the user selected in the zoning review, if any. */
  activityLabel?: string | null;
  /**
   * The user's own answers from the review questions, as
   * question/answer pairs. These carry the unresolved specifics
   * (seating, alcohol, headcount) that decide a use category.
   */
  reviewAnswers?: { question: string; answer: string }[];
  /** Official sources a helper needs: use table, zoning layer, ordinance. */
  officialLinks?: StageHandoffLink[];
  /** Link back to the full report, offered as optional context, last. */
  reportUrl?: string | null;
}

export interface StageHandoff {
  /** One-line subject, usable as an email subject or message opener. */
  subject: string;
  /** Plain-text body, ready for share sheet, clipboard, or email. */
  body: string;
}

const NOT_PROVIDED = "Not provided";

function line(label: string, value: string): string {
  return `${label}: ${value}`;
}

/**
 * Build the zoning-stage handoff.
 *
 * Output is plain text on purpose. It must survive SMS, email, WhatsApp,
 * and a printout without formatting loss, and a navigator should be able
 * to read the whole thing in under thirty seconds.
 */
export function buildZoningHandoff(input: ZoningHandoffInput): StageHandoff {
  const address = input.address?.trim() || NOT_PROVIDED;
  const businessType = input.businessType?.trim() || NOT_PROVIDED;
  const zoneClass = input.zoneClass?.trim() || "Not published for this location";

  const subject = `Zoning question — ${businessType === NOT_PROVIDED ? address : businessType + " at " + address}`;

  const parts: string[] = [];

  parts.push("ZONING-STAGE HANDOFF (Chicago Incentive Explorer)");
  parts.push("");
  parts.push(line("Address", address));
  parts.push(line("Business", businessType));
  parts.push(line("Published zoning designation", zoneClass));
  parts.push(line("Stage", "Zoning — confirming whether this use can operate here"));
  parts.push("");

  if (input.activityLabel?.trim()) {
    parts.push(`Open question: whether "${input.activityLabel.trim()}" can operate at this address under the designation above. The Explorer does not determine this — it needs confirmation against the ordinance's use tables.`);
  } else {
    parts.push("Open question: whether the intended use can operate at this address under the designation above. The Explorer does not determine this — it needs confirmation against the ordinance's use tables.");
  }

  const answers = (input.reviewAnswers ?? []).filter(
    (entry) => entry.question.trim() && entry.answer.trim(),
  );
  if (answers.length > 0) {
    parts.push("");
    parts.push("Details the user provided (these can decide the use category):");
    for (const entry of answers) {
      parts.push(`- ${entry.question.trim()} ${entry.answer.trim()}`);
    }
  }

  const links = (input.officialLinks ?? []).filter((l) => l.label.trim() && l.url.trim());
  if (links.length > 0) {
    parts.push("");
    parts.push("Official sources:");
    for (const l of links) {
      parts.push(`- ${l.label.trim()}: ${l.url.trim()}`);
    }
  }

  if (input.reportUrl?.trim()) {
    parts.push("");
    parts.push(`Full site report (optional context): ${input.reportUrl.trim()}`);
  }

  parts.push("");
  parts.push("This summary is from a discovery tool. It does not determine eligibility or use permissions — verify with the administering agency.");

  return { subject, body: parts.join("\n") };
}
