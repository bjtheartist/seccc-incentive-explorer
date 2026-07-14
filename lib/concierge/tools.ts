/**
 * Read-only concierge tools (Stage 1). None of these write to a database, none
 * require authentication, and every one returns SOURCED facts only:
 *   - searchPrograms / getProgram  → public/data/programs.json
 *   - listZonesAtPoint             → the same point-in-zone logic as the report
 *   - getPageContext               → echoes the client-provided page context
 *   - navigateTo                   → validates an allowlisted route to SUGGEST
 *
 * getProgram always carries officialUrl so the model can cite it. navigateTo
 * never navigates — it returns a suggestion the UI renders as a button.
 */
import { tool } from "ai";
import { z } from "zod";
import {
  getProgram as lookupProgram,
  searchPrograms as searchProgramIndex,
} from "./programs-index";
import { resolveZonesAtPoint } from "@/lib/zones-check";
import { resolveNavTarget } from "./navigation";
import type { ConciergePageContext } from "./types";
import {
  buildConciergeActionTools,
  type ConciergeActionDeps,
} from "./action-tools";
import { buildConciergeWorkspaceTools } from "./workspace-tools";

export interface ConciergeToolDeps {
  /** Page context the client sent with the request (echoed by getPageContext). */
  pageContext: ConciergePageContext;
  /** Called (best-effort) whenever a tool executes, for server-side telemetry. */
  onToolCall?: (toolName: string) => void;
  /**
   * Present ONLY for a signed-in user. When set, the approval-gated action tools
   * (profile/packet updates, support-request draft) are merged into the same
   * tool map. Guests (no `actions`) get exactly the Stage-1 read-only map.
   */
  actions?: ConciergeActionDeps;
}

export function buildConciergeTools({ pageContext, onToolCall, actions }: ConciergeToolDeps) {
  const readOnlyTools = {
    searchPrograms: tool({
      description:
        "Search the Chicago incentive program dataset by keyword (name, summary, who-qualifies, benefits). Use this first to find candidate programs. Returns sourced summaries with officialUrl.",
      inputSchema: z.object({
        query: z
          .string()
          .max(200)
          .describe("Keywords, e.g. 'storefront renovation' or 'hiring'."),
        level: z
          .enum(["Federal", "State", "County", "City", "Utility"])
          .optional()
          .describe("Optional government level filter."),
      }),
      execute: async ({ query, level }) => {
        onToolCall?.("searchPrograms");
        const results = await searchProgramIndex(query, { level });
        return {
          count: results.length,
          programs: results,
          note: "Descriptive matches only. A match is not an eligibility determination.",
        };
      },
    }),

    getProgram: tool({
      description:
        "Get full sourced detail for one program by id or name, including officialUrl and descriptive next-step verificationSteps. Cite officialUrl whenever you mention this program.",
      inputSchema: z.object({
        idOrName: z
          .string()
          .max(200)
          .describe("Program id (e.g. 'tif') or exact/partial name."),
      }),
      execute: async ({ idOrName }) => {
        onToolCall?.("getProgram");
        const program = await lookupProgram(idOrName);
        if (!program) {
          return {
            found: false,
            note: "No matching program in the dataset. Do not invent details.",
          };
        }
        return { found: true, program };
      },
    }),

    listZonesAtPoint: tool({
      description:
        "List which incentive zones (TIF, Enterprise Zone, Opportunity Zone, NOF corridor, SSA, etc.) cover a specific latitude/longitude. Location coverage only — NOT an eligibility determination.",
      inputSchema: z.object({
        lat: z.number().min(-90).max(90).describe("Latitude in decimal degrees."),
        lon: z.number().min(-180).max(180).describe("Longitude in decimal degrees."),
      }),
      execute: async ({ lat, lon }) => {
        onToolCall?.("listZonesAtPoint");
        const zones = await resolveZonesAtPoint(lat, lon);
        return {
          count: zones.length,
          zones,
          note: "Zone coverage indicates a program MAY apply at this location. Verify eligibility with the program administrator.",
        };
      },
    }),

    getPageContext: tool({
      description:
        "Get context about the current page and, if present, the report summary, address, place-based support organizations, and separate financing/development match. Use this before naming an organization so the suggestion stays grounded in what the Explorer surfaced.",
      inputSchema: z.object({}),
      execute: async () => {
        onToolCall?.("getPageContext");
        return { pageContext };
      },
    }),

    navigateTo: tool({
      description:
        "Suggest an in-app page for the visitor to open. Allowed routes include /map, /report, /faq, /workspace, /workspace/business-file, /programs, real /programs/{slug} pages, and owner workspace deep-links returned by action tools. This does NOT navigate — the visitor sees a button and chooses.",
      inputSchema: z.object({
        route: z
          .string()
          .max(200)
          .describe("An allowlisted path, e.g. '/map' or '/programs/tif'."),
        label: z
          .string()
          .max(60)
          .optional()
          .describe("Short button label, e.g. 'Open the map'."),
        reason: z
          .string()
          .max(200)
          .optional()
          .describe("One short sentence on why this page helps."),
      }),
      execute: async ({ route, label, reason }) => {
        onToolCall?.("navigateTo");
        const target = resolveNavTarget(route, label);
        if (!target) {
          return {
            ok: false,
            note: "That route is not allowlisted. Offer /map, /report, /faq, /workspace, /programs, or a /programs/{slug} page instead.",
          };
        }
        return {
          ok: true,
          suggestion: { ...target, reason: reason ?? null },
          note: "A 'Take me there' button is shown to the visitor. Do not claim they have navigated.",
        };
      },
    }),
  };

  if (!actions) return readOnlyTools;

  // Signed-in: add owner-scoped workspace reads, then merge the approval-gated
  // actions. Read tools auto-execute; only mutation tools need approval.
  return {
    ...readOnlyTools,
    ...buildConciergeWorkspaceTools({ ...actions, onToolCall }),
    ...buildConciergeActionTools({ ...actions, onToolCall }),
  };
}

export type ConciergeTools = ReturnType<typeof buildConciergeTools>;
