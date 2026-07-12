import { searchPrograms } from "./programs-index";
import { resolveZonesAtPoint } from "@/lib/zones-check";
import type { ConciergePageContext } from "./types";

const ACTION_REQUEST_RE =
  /\b(update|change|save|record|remember|set|add|remove|clear|mark|start|create|draft|prepare)\b[\s\S]{0,120}\b(profile|business file|packet|task|support request|legal name|dba|contact|email|phone|address|entity type|formation date|industry|naics|employee(?:s| count)?|ownership)\b/i;
const WORKSPACE_ACTION_VERB_RE =
  /\b(update|change|save|record|remember|set|add|remove|clear|mark|start|create|draft|prepare|go ahead|do it)\b/i;

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
  if (
    signedIn &&
    (ACTION_REQUEST_RE.test(text) ||
      (pageContext.route.startsWith("/workspace") &&
        WORKSPACE_ACTION_VERB_RE.test(text)))
  ) {
    return null;
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
      return `Here is the report's plain-language starting point:\n\n${pageContext.reportSummary}\n\nThese are location and program signals, not an eligibility or award decision. Review each surfaced program's official source and verify the project details with its administrator.`;
    }
    return "This page helps you discover programs and location signals. Start with an address and what the business is trying to do, then review each program's official source. [Build an incentive report](/report)";
  }

  if (/\b(zone|district|opportunity zone|enterprise zone|cover(?:s|ed)?)\b/i.test(text)) {
    if (typeof pageContext.lat === "number" && typeof pageContext.lon === "number") {
      const zones = await resolveZonesAtPoint(pageContext.lat, pageContext.lon);
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
    const programs = await programsForQueries(queries);
    if (programs.length > 0) {
      return [
        "These sourced programs may be worth exploring based on the goal you described:",
        "",
        ...programLines(programs),
        "",
        "This is a descriptive match, not an eligibility or award decision. Confirm current requirements, timing, and project fit with each program administrator.",
      ].join("\n");
    }
  }

  if (/\b(eligible|eligibility|qualify|qualified)\b/i.test(text)) {
    return "I can't decide whether a business qualifies. I can help you compare the program's published requirements, check mapped location coverage, and identify what to verify with the program administrator. Tell me the program name, address, and what the business plans to do.";
  }

  if (/\b(incentive|grant|credit|funding|program|business file|packet)\b/i.test(lower)) {
    return "Tell me the business address and the priority: improving the space, hiring, buying equipment, opening or relocating, or exploring. I can point you to sourced programs and the next preparation step without deciding eligibility or estimating a total award.";
  }

  return "I can help with Chicago business incentives, location reports, Business Files, and Incentive Preparedness Packets. What is the business trying to do: improve its space, hire, buy equipment, open or relocate, or just explore?";
}
