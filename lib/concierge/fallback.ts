import { searchPrograms } from "./programs-index";
import { resolveZoneEvidenceV2 } from "@/lib/zones-check";
import { CHECKABLE_ZONE_KEYS } from "@/lib/constants";
import type { ConciergePageContext } from "./types";

const ACTION_REQUEST_RE =
  /\b(update|change|save|record|remember|set|add|remove|clear|mark|start|create|draft|prepare)\b[\s\S]{0,120}\b(profile|business file|packet|task|support request|legal name|dba|contact|email|phone|address|entity type|formation date|industry|naics|employee(?:s| count)?|ownership)\b/i;
const WORKSPACE_ACTION_VERB_RE =
  /\b(update|change|save|record|remember|set|add|remove|clear|mark|start|create|draft|prepare|go ahead|do it)\b/i;
const INTRODUCTION_ACTION_RE =
  /(?:\b(request|prepare|make|arrange|send|set up)\b[\s\S]{0,100}\b(introduction|local support|support organization|partner|delegate agenc(?:y|ies)|cdfi)\b|\b(connect|introduce)\s+(?:me|us|my business|our business)\b)/i;
const LOCAL_SUPPORT_GUIDANCE_RE =
  /\b(get connected|local support|support organization|delegate agenc(?:y|ies)|who can help|help me find (?:someone|an organization)|next local (?:resource|organization)|warm handoff)\b/i;
const MATERIAL_REVIEW_SUPPORT_RE =
  /\b(1:1|one[- ]on[- ]one|human|advisor)\b[\s\S]{0,100}\b(review(?:ing)?|check(?:ing)?|look(?:ing)? over)\b[\s\S]{0,80}\b(materials?|documents?|packet|application)\b|\b(review(?:ing)?|check(?:ing)?|look(?:ing)? over)\b[\s\S]{0,80}\b(materials?|documents?|packet|application)\b[\s\S]{0,100}\b(1:1|one[- ]on[- ]one|human|advisor)\b/i;
const PROGRAM_DISCOVERY_RE =
  /\b(which|what|find|show|list|recommend|suggest|explore|are there|is there|any)\b[\s\S]{0,70}\b(programs?|incentives?|grants?|credits?|funding)\b|\b(programs?|incentives?|grants?|credits?|funding)\b[\s\S]{0,70}\b(available|could help|should i explore|for my|for buying|for purchasing)\b/i;

export function shouldUseSignedInActionTools({
  text,
  pageContext,
  signedIn,
}: {
  text: string;
  pageContext: ConciergePageContext;
  signedIn: boolean;
}): boolean {
  return Boolean(
    signedIn &&
      (ACTION_REQUEST_RE.test(text) ||
        INTRODUCTION_ACTION_RE.test(text) ||
        MATERIAL_REVIEW_SUPPORT_RE.test(text) ||
        (pageContext.route.startsWith("/workspace") &&
          WORKSPACE_ACTION_VERB_RE.test(text)))
  );
}

function isSavedRecordActionRequest(
  text: string,
  pageContext: ConciergePageContext
): boolean {
  return Boolean(
    ACTION_REQUEST_RE.test(text) ||
      INTRODUCTION_ACTION_RE.test(text) ||
      MATERIAL_REVIEW_SUPPORT_RE.test(text) ||
      (pageContext.route.startsWith("/workspace") &&
        WORKSPACE_ACTION_VERB_RE.test(text))
  );
}

function localPartnerOffer(pageContext: ConciergePageContext): string {
  const names = [
    pageContext.localSupportOrganizations?.[0]?.name,
    pageContext.capitalSupportName,
  ]
    .filter((name): name is string => Boolean(name))
    .filter((name, index, all) => all.indexOf(name) === index)
    .slice(0, 2);
  const surfaced = names.length > 0
    ? ` Your report surfaced ${names.join(" and ")} as possible starting points.`
    : "";

  return `${surfaced} Would you like help connecting with a local partner who fits the project? A connection is optional and does not confirm eligibility or approval.`;
}

function nextGuidedOffer(pageContext: ConciergePageContext): string {
  if (pageContext.reportSummary) return localPartnerOffer(pageContext);
  return "Would you like to run a **Site Incentive Report** for a specific address? [Run a Site Incentive Report](/report) to check location-linked programs and support signals. The report is informational and does not determine eligibility.";
}

function programLines(
  programs: Awaited<ReturnType<typeof searchPrograms>>
): string[] {
  return programs.map(
    (program) =>
      `- **${program.name}**: ${program.summary} [Program page](${program.detailRoute}) | [Official details](${program.officialUrl})`
  );
}

async function programsForQueries(queries: string[]) {
  const resultSets = await Promise.all(
    queries.map((query) => searchPrograms(query, { limit: 3 }))
  );
  const seen = new Set<string>();
  return resultSets
    .flat()
    .filter((program) => {
      if (seen.has(program.id)) return false;
      seen.add(program.id);
      return true;
    })
    .slice(0, 5);
}

function goalQueries(text: string): string[] {
  const queries: string[] = [];
  if (/\b(remodel|renovate|storefront|facade|improve (?:my |the )?space)\b/i.test(text)) {
    queries.push("storefront renovation");
  }
  if (/\b(hire|hiring|employee|employees|workforce|jobs?)\b/i.test(text)) {
    queries.push("hiring workforce");
  }
  if (/\b(equipment|machinery|manufactur)/i.test(text)) {
    queries.push("equipment manufacturing");
  }
  if (/\b(open|opening|relocate|relocation|new location|daycare)\b/i.test(text)) {
    queries.push("open relocate business");
  }
  if (/\b(vacant|rehab|redevelop|building acquisition)\b/i.test(text)) {
    queries.push("vacant building redevelopment");
  }
  for (const acronym of text.match(/\b(tif|sbif|nof|wotc)\b/gi) ?? []) {
    queries.push(acronym.toLowerCase());
  }
  return [...new Set(queries)];
}

/**
 * Zero-model, sourced response path for common concierge requests. It keeps the
 * guide useful during provider throttling and avoids spending model calls on
 * simple navigation or hard-boundary questions.
 */
export async function buildDeterministicConciergeResponse({
  userText,
  pageContext,
  signedIn,
}: {
  userText: string;
  pageContext: ConciergePageContext;
  signedIn: boolean;
}): Promise<string | null> {
  const text = userText.trim();
  const lower = text.toLowerCase();
  if (!text) return null;

  // Leave nuanced owner-authorized writes to the approval-gated model tools.
  if (shouldUseSignedInActionTools({ text, pageContext, signedIn })) {
    return null;
  }

  if (!signedIn && MATERIAL_REVIEW_SUPPORT_RE.test(text)) {
    return "You can request 1:1 support to review assembled materials for completeness and open questions. That review does not confirm eligibility, certify documents, or submit an application. To prepare a support request and control what may be shared, [sign in to your workspace](/login?callbackUrl=/workspace). Nothing has been shared or scheduled.";
  }

  if (!signedIn && INTRODUCTION_ACTION_RE.test(text)) {
    return "You don't need to have every detail figured out before talking with someone. I can help organize what you're working toward and any open questions so you don't have to start from scratch. To save that summary and request an introduction, [sign in to your workspace](/login?callbackUrl=/workspace). Nothing has been shared with an organization.";
  }

  if (!signedIn && isSavedRecordActionRequest(text, pageContext)) {
    return "I can't change a Business File or Incentive Preparedness Packet while you're signed out. Nothing was changed. [Sign in to your workspace](/login?callbackUrl=/workspace), then the guide can propose a saved-record update for your approval.";
  }

  if (
    /^(?:hi|hello|hey|good (?:morning|afternoon|evening))[!.\s]*$/i.test(text) ||
    /\b(just explore|what can i explore|help me (?:get started|explore|understand what))\b/i.test(
      text
    )
  ) {
    return "I can help with Chicago business incentives, location reports, Business Files, and getting connected to local support. What is the business trying to do: improve its space, hire, buy equipment, open or relocate, or just explore?";
  }

  if (LOCAL_SUPPORT_GUIDANCE_RE.test(text)) {
    if (pageContext.reportSummary) {
      return `Your Site Incentive Report gives us a location-specific starting point.${localPartnerOffer(pageContext)}`;
    }
    return "You don't need to have every detail figured out before talking with someone. To help identify a useful next connection, where does the project stand right now: are you exploring an idea, actively planning, or is the work already underway? This helps shape the conversation; it is not an eligibility, viability, or readiness score.";
  }

  if (/\b(corridor score|internal score|internal ranking|ranked against)\b/i.test(text)) {
    return "I can't expose internal scores, rankings, or model reasoning. I can help you review the sourced programs, location signals, and preparation steps that are visible in the Explorer.";
  }

  if (
    /\b(add up|sum|total|top[- ]line)\b[\s\S]{0,90}\b(incentive|grant|credit|dollar|funding|deal)\b/i.test(
      text
    )
  ) {
    return "I can't turn program figures into one possible-incentive-dollar total or deal budget. Published program amounts are individual program facts, not an award forecast. I can help you review each program separately and identify what to verify with its administrator.";
  }

  if (/\b(submit|certify|sign|attest)\b[\s\S]{0,60}\b(application|packet|form|information)\b/i.test(text)) {
    return "I can help you prepare and organize, but I can't certify or submit information for you. Those final steps stay with you or an authorized representative in the official process. [Open your workspace](/workspace)";
  }

  if (
    /\b(alderman(?:ic)?|ward office|local chamber|chamber of commerce|lender|support letter|letter of support)\b/i.test(
      text
    )
  ) {
    return [
      "There is not one official stakeholder sequence in the Explorer. A cautious preparation order is:",
      "",
      "1. Write down the project address, business priority, scope, timing, and financing needs.",
      "2. Check the program's official instructions or ask its administrator which documents, financing evidence, or support letters are actually required.",
      "3. If useful, ask a local chamber or business-support organization to help organize the request and identify the right contacts.",
      "4. Involve a lender when outside financing is part of the project and ask what underwriting documents they need.",
      "5. Contact the aldermanic office when the official program guidance or local project context indicates that ward-level coordination would be useful.",
      "",
      "This is an optional coordination plan, not an official application order. A chamber, lender, or aldermanic office should not be treated as confirming program eligibility unless the program's official rules give that party a formal role.",
      "",
      "[Build an address report](/report) or [organize the project in your workspace](/workspace).",
    ].join("\n");
  }

  if (/\b(faq|frequently asked)\b/i.test(text)) {
    return "You can open the [frequently asked questions](/faq). I can also help you find a program, check an address, or understand a report.";
  }
  if (/\b(map|look at my block|location map)\b/i.test(text)) {
    return "Open the [incentive map](/map) to explore your block, then build a report for a specific address. Location coverage is a proximity signal, not an eligibility determination.";
  }
  if (/\b(show|browse|see|list)\b[\s\S]{0,35}\b(all )?programs\b/i.test(text)) {
    return "Browse the Explorer's [program directory](/programs). It is the current sourced dataset, and program administrators make final eligibility and award decisions.";
  }

  if (/\b(explain|understand|plain language)\b[\s\S]{0,45}\b(report|page|this)\b/i.test(text)) {
    if (pageContext.reportSummary) {
      return `Here is the report's plain-language starting point:\n\n${pageContext.reportSummary}\n\nThese are location and program signals, not an eligibility or award decision. Review each surfaced program's official source and verify the project details with its administrator.\n\n${localPartnerOffer(pageContext)}`;
    }
    return "This page helps you discover programs and location signals. Start with an address and what the business is trying to do, then review each program's official source. [Build an incentive report](/report)";
  }

  if (/\b(zone|district|opportunity zone|enterprise zone|cover(?:s|ed)?)\b/i.test(text)) {
    if (typeof pageContext.lat === "number" && typeof pageContext.lon === "number") {
      // Zone Evidence v2 (build-spec.md 2.3; audit F2): an empty match list
      // is only an honest "no overlay" claim when every layer actually
      // resolved. A layer this deterministic fallback could not check must
      // never be reported as confirmed absent.
      const evidence = await resolveZoneEvidenceV2(
        pageContext.lat,
        pageContext.lon,
        CHECKABLE_ZONE_KEYS,
      );
      const zones = Object.entries(evidence)
        .filter(([, entry]) => entry.state === "matched")
        .map(([key, entry]) => ({ key, name: entry.name }));
      const unknownCount = Object.values(evidence).filter((entry) => entry.state === "unknown").length;
      if (zones.length === 0 && unknownCount > 0) {
        return `${unknownCount} mapped-zone layer(s) could not be checked right now. That is an incomplete check, not confirmation the address is outside any incentive-zone overlay. Try again shortly or verify directly with the relevant administrators.`;
      }
      if (zones.length === 0) {
        return "The current report coordinates did not return a mapped incentive-zone overlay. That is a location result only, not an eligibility finding. Verify current boundaries with the relevant administrators.";
      }
      const names = zones
        .slice(0, 10)
        .map((zone) => `- ${zone.name || zone.key}`)
        .join("\n");
      return `The current report coordinates intersect these mapped overlays:\n\n${names}\n\nCoverage means a program may be worth exploring; it does not confirm eligibility. Verify the current boundary and project rules with administrators.`;
    }
    return "I need a report location before I can check mapped zone coverage. [Build a report for the address](/report), then ask me again. Coverage is not an eligibility determination.";
  }

  const queries = goalQueries(text);
  if (queries.length > 0) {
    if (!PROGRAM_DISCOVERY_RE.test(text)) {
      return `That gives me a clear starting point.\n\n${nextGuidedOffer(pageContext)}`;
    }
    const programs = await programsForQueries(queries);
    if (programs.length > 0) {
      return [
        "These sourced programs may be worth exploring based on the goal you described:",
        "",
        ...programLines(programs),
        "",
        "This is a descriptive match, not an eligibility or award decision. Confirm current requirements, timing, and project fit with each program administrator.",
        "",
        nextGuidedOffer(pageContext),
      ].join("\n");
    }
    return nextGuidedOffer(pageContext);
  }

  if (/\b(eligible|eligibility|qualify|qualified)\b/i.test(text)) {
    return "I can't decide whether a business qualifies. I can help you compare the program's published requirements, check mapped location coverage, and identify what to verify with the program administrator. Tell me the program name, address, and what the business plans to do.";
  }

  if (/\b(incentive|grant|credit|funding|program|business file|packet)\b/i.test(lower)) {
    return "Tell me the business address and the priority: improving the space, hiring, buying equipment, opening or relocating, or exploring. I can point you to sourced programs and the next preparation step without deciding eligibility or estimating a total award.";
  }

  // Let the model handle nuanced, in-domain conversation. The route supplies a
  // useful generic response instead when no model credential is available.
  return null;
}
