/**
 * Signed-in concierge ACTION tools (Stage 2). Added to the same tool map as the
 * read-only Stage 1 tools, but ONLY for an authenticated user. Every one of
 * these:
 *
 *   1. Is APPROVAL-GATED via the AI SDK's native tool-approval flow
 *      (`needsApproval: true`). The model proposes the call; the executor does
 *      not run until the human clicks Approve in the panel. A decline yields the
 *      SDK's `output-denied` state and never touches the database.
 *
 *   2. RE-VERIFIES OWNERSHIP server-side in the executor. The user id comes from
 *      the session (captured in the route, closed over here) — NEVER from model
 *      output. Any id the model supplies is checked against `WHERE user_id = $me`
 *      before the action runs. An unowned id returns a polite tool result.
 *
 *   3. COMPOSES with the existing auth-gated routes instead of re-implementing
 *      their guards. For routes that exist on THIS branch we call the exported
 *      handler in-process (it re-runs its own auth + validation + boundary
 *      checks). For the Tier-2 "foundation" routes that live on the business-file
 *      branches (NOT here), we call by URL with the user's cookies and DEGRADE
 *      gracefully to a deep-link when the route 404s. See CROSS-BRANCH notes.
 *
 * Boundary (re-asserted for actions): these tools PREPARE and ORGANIZE. They
 * never certify, submit, or send anything externally. `prepareSupportRequest`
 * only drafts — the consent checkbox and the actual POST stay in the existing
 * consent-gated packet UI, which this tool deep-links to.
 */
import { tool } from "ai";
import { z } from "zod";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { isGoalType } from "@/lib/workspace";
import { resolveNavTarget } from "./navigation";

// NOTE: the existing auth-gated route handlers are DYNAMICALLY imported inside
// the executors (below), not statically at the top level. That keeps the
// next-auth adapter chain (which is not ESM-`exports`-clean under plain tsx) out
// of every module that merely imports the tool map — it only loads inside the
// Next server when an action actually runs.

type SQL = NeonQueryFunction<false, false>;

type RouteHandler = (
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) => Promise<Response>;

export interface ConciergeActionDeps {
  /** Session user id — captured server-side from next-auth, never from the model. */
  userId: string;
  /** Neon client (present only when the DB is configured). */
  sql: SQL;
  /** Absolute origin (proto://host) for cross-branch route composition. */
  requestOrigin: string;
  /** The signed-in user's cookie header, forwarded on cross-branch URL calls. */
  cookieHeader: string;
  /** Best-effort per-tool telemetry hook. */
  onToolCall?: (toolName: string) => void;
}

/** Call an in-process App Router handler with a synthetic authenticated request. */
async function callHandler(
  handler: RouteHandler,
  opts: {
    origin: string;
    path: string;
    method: string;
    cookieHeader: string;
    id?: string;
    body?: unknown;
  }
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const req = new NextRequest(new URL(opts.path, opts.origin), {
    method: opts.method,
    headers: {
      "content-type": "application/json",
      ...(opts.cookieHeader ? { cookie: opts.cookieHeader } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const res = await handler(req, { params: Promise.resolve({ id: opts.id ?? "" }) });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, json };
}

/** Ownership-scoped profile lookup. Returns the row id or null. */
async function ownedProfileId(
  sql: SQL,
  userId: string,
  profileId?: string | null
): Promise<string | null> {
  if (profileId) {
    const rows = await sql`
      SELECT id FROM business_profiles
      WHERE id = ${profileId} AND user_id = ${userId}
      LIMIT 1
    `;
    return rows.length ? String((rows[0] as { id: string }).id) : null;
  }
  const rows = await sql`
    SELECT id FROM business_profiles
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return rows.length ? String((rows[0] as { id: string }).id) : null;
}

/** Ownership check for a packet id. */
async function ownsPacket(
  sql: SQL,
  userId: string,
  packetId: string
): Promise<boolean> {
  const rows = await sql`
    SELECT id FROM incentive_preparation_packets
    WHERE id = ${packetId} AND user_id = ${userId}
    LIMIT 1
  `;
  return rows.length > 0;
}

const NOT_YOURS = {
  ok: false as const,
  note:
    "I couldn't find that under your account, so I didn't change anything. It may belong to a different profile, or you may need to create it first.",
};

export function buildConciergeActionTools(deps: ConciergeActionDeps) {
  const { userId, sql, requestOrigin, cookieHeader, onToolCall } = deps;

  return {
    updateBusinessProfile: tool({
      description:
        "Update the signed-in owner's saved business profile (name, address, contact, entity type, industry, NAICS, employee count, etc). REQUIRES the user's approval before it runs. Only fields you set in `changes` are updated. Do not guess values — only save what the owner told you.",
      inputSchema: z.object({
        businessProfileId: z
          .string()
          .max(200)
          .optional()
          .describe(
            "The owner's business profile id, if known. Omit to update their most recent profile."
          ),
        changes: z
          .object({
            legalName: z.string().max(300).nullable().optional(),
            dbaName: z.string().max(300).nullable().optional(),
            physicalAddress: z.string().max(300).nullable().optional(),
            mailingAddress: z.string().max(300).nullable().optional(),
            contactName: z.string().max(200).nullable().optional(),
            contactEmail: z.string().max(200).nullable().optional(),
            contactPhone: z.string().max(60).nullable().optional(),
            entityType: z.string().max(120).nullable().optional(),
            formationDate: z.string().max(20).nullable().optional(),
            industry: z.string().max(200).nullable().optional(),
            naicsCode: z.string().max(20).nullable().optional(),
            ownershipNotes: z.string().max(2000).nullable().optional(),
            employeeCount: z.number().int().min(0).nullable().optional(),
          })
          .describe("Only the fields to change."),
      }),
      needsApproval: true,
      execute: async ({ businessProfileId, changes }) => {
        onToolCall?.("updateBusinessProfile");
        const id = await ownedProfileId(sql, userId, businessProfileId);
        if (!id) {
          return {
            ...NOT_YOURS,
            note:
              "I don't see a saved business profile on your account yet. You can create one in the workspace, then I can help keep it up to date.",
            suggestion: resolveNavTarget(
              "/workspace/incentive-preparation/new",
              "Start a profile"
            ),
          };
        }
        if (!changes || Object.keys(changes).length === 0) {
          return { ok: false, note: "No fields to change were provided." };
        }
        const { PATCH: patchBusinessProfile } = await import(
          "@/app/api/business-profiles/[id]/route"
        );
        const { status, json } = await callHandler(patchBusinessProfile, {
          origin: requestOrigin,
          path: `/api/business-profiles/${id}`,
          method: "PATCH",
          cookieHeader,
          id,
          body: changes,
        });
        if (status >= 400 || !json) {
          return {
            ok: false,
            note:
              (json?.error as string) ||
              "That update didn't go through. Nothing was changed.",
          };
        }
        return {
          ok: true,
          updatedFields: Object.keys(changes),
          note: "Saved to your business profile.",
        };
      },
    }),

    updatePacketTask: tool({
      description:
        "Mark an applicant-controlled task on an Incentive Preparation Packet as (for example) in progress or complete. REQUIRES the user's approval. Certification/submission tasks are protected and cannot be completed here — those belong only to the applicant in the official process.",
      inputSchema: z.object({
        packetId: z.string().max(200).describe("The packet id."),
        taskId: z.string().max(200).describe("The task id within the packet."),
        status: z
          .enum([
            "not_started",
            "in_progress",
            "blocked",
            "complete",
            "requires_certification",
          ])
          .describe("The new task status."),
      }),
      needsApproval: true,
      execute: async ({ packetId, taskId, status }) => {
        onToolCall?.("updatePacketTask");
        if (!(await ownsPacket(sql, userId, packetId))) return NOT_YOURS;
        const { PATCH: patchPacketTask } = await import(
          "@/app/api/incentive-preparation/[id]/route"
        );
        const { status: httpStatus, json } = await callHandler(patchPacketTask, {
          origin: requestOrigin,
          path: `/api/incentive-preparation/${packetId}`,
          method: "PATCH",
          cookieHeader,
          id: packetId,
          body: { taskId, status },
        });
        if (httpStatus >= 400 || !json) {
          return {
            ok: false,
            note:
              (json?.error as string) ||
              "I couldn't update that task. It may be a protected certification step, which only you can complete in the official process.",
          };
        }
        return { ok: true, taskId, status, note: "Task updated on your packet." };
      },
    }),

    createFoundationPacket: tool({
      description:
        "Start an Incentive Preparation Packet ('application prep') for the signed-in owner, building the foundation task list and timeline from their saved profile. REQUIRES the user's approval. Needs a program name and a project goal.",
      inputSchema: z.object({
        programName: z.string().max(200).describe("The program the packet is for."),
        programId: z.string().max(120).optional().describe("Program id if known."),
        goalType: z
          .string()
          .max(60)
          .describe(
            "One of: hire-staff, expand-location, open-relocate, acquire-vacant-property, development-feasibility."
          ),
        projectAddress: z.string().max(300).optional(),
        businessProfileId: z
          .string()
          .max(200)
          .optional()
          .describe("Profile to base the packet on. Omit for the most recent."),
      }),
      needsApproval: true,
      execute: async ({
        programName,
        programId,
        goalType,
        projectAddress,
        businessProfileId,
      }) => {
        onToolCall?.("createFoundationPacket");
        if (!isGoalType(goalType)) {
          return {
            ok: false,
            note: "That project goal isn't one I can use. Ask the owner which goal fits, then try again.",
          };
        }
        const profileId = await ownedProfileId(sql, userId, businessProfileId);
        if (!profileId) {
          return {
            ok: false,
            note:
              "You'll need a saved business profile first — I can walk you through it in the workspace, then start the packet.",
            suggestion: resolveNavTarget(
              "/workspace/incentive-preparation/new",
              "Start a profile & packet"
            ),
          };
        }
        // Composes with the packet-creation route that exists on this branch.
        // CROSS-BRANCH: the business-file branches may replace this with a
        // dedicated foundation endpoint; because we call the route (not its
        // internals) the composition survives that swap.
        const { POST: createPacket } = await import(
          "@/app/api/incentive-preparation/route"
        );
        const { status, json } = await callHandler(createPacket, {
          origin: requestOrigin,
          path: `/api/incentive-preparation`,
          method: "POST",
          cookieHeader,
          body: { programName, programId, goalType, projectAddress, profileId },
        });
        if (status >= 400 || !json) {
          return {
            ok: false,
            note:
              (json?.error as string) ||
              "I couldn't start the packet just now. You can start one directly in the workspace.",
            suggestion: resolveNavTarget(
              "/workspace/incentive-preparation/new",
              "Start a packet"
            ),
          };
        }
        const packet = (json.packet as { id?: string } | undefined) ?? undefined;
        const packetId = packet?.id ? String(packet.id) : undefined;
        return {
          ok: true,
          packetId: packetId ?? null,
          note: `Started your ${programName} application-prep packet.`,
          suggestion: packetId
            ? resolveNavTarget(
                `/workspace/incentive-preparation/${packetId}`,
                "Open your packet"
              )
            : null,
        };
      },
    }),

    selectPacketProgram: tool({
      description:
        "Set (or change) which program an existing Incentive Preparation Packet targets. REQUIRES the user's approval.",
      inputSchema: z.object({
        packetId: z.string().max(200).describe("The packet id to update."),
        programId: z.string().max(120).describe("The program id to target."),
        programName: z.string().max(200).describe("The program name."),
      }),
      needsApproval: true,
      execute: async ({ packetId, programId, programName }) => {
        onToolCall?.("selectPacketProgram");
        if (!(await ownsPacket(sql, userId, packetId))) return NOT_YOURS;

        // CROSS-BRANCH DEPENDENCY: the program-selection endpoint for a foundation
        // packet lives on the business-file branches, NOT this one. We call it by
        // URL with the user's cookies and DEGRADE gracefully to a deep-link when
        // it 404s here. When the branches merge this lights up with no code change.
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2500);
          const res = await fetch(
            new URL(
              `/api/incentive-preparation/${packetId}/select-program`,
              requestOrigin
            ),
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                ...(cookieHeader ? { cookie: cookieHeader } : {}),
              },
              body: JSON.stringify({ programId, programName }),
              signal: controller.signal,
            }
          ).finally(() => clearTimeout(timer));

          if (res.ok) {
            return {
              ok: true,
              packetId,
              programId,
              note: `Set your packet to target ${programName}.`,
            };
          }
          // 404 (not on this branch) or any other non-2xx → degrade.
        } catch {
          // network/abort → degrade.
        }

        return {
          ok: true,
          degraded: true,
          note: `Program selection for an existing packet isn't wired up in this environment yet. Open your packet to choose ${programName} there.`,
          suggestion: resolveNavTarget(
            `/workspace/incentive-preparation/${packetId}`,
            "Open your packet"
          ),
        };
      },
    }),

    prepareSupportRequest: tool({
      description:
        "Draft a partner support request for a packet (which organization, what help, which data to share). REQUIRES the user's approval to draft. This ONLY prepares a draft — it never sends anything. The owner reviews it, ticks the consent box, and submits it themselves in the packet's Request-support form.",
      inputSchema: z.object({
        packetId: z.string().max(200).describe("The packet the request is for."),
        targetOrganization: z
          .string()
          .max(200)
          .describe("The partner organization to ask for help."),
        requestedHelp: z
          .string()
          .max(2000)
          .describe("A short description of the help being requested."),
        suggestedScopes: z
          .array(
            z.enum([
              "business_profile",
              "packet",
              "documents",
              "contact_information",
            ])
          )
          .optional()
          .describe("Which data scopes to suggest sharing (the owner confirms)."),
      }),
      needsApproval: true,
      execute: async ({
        packetId,
        targetOrganization,
        requestedHelp,
        suggestedScopes,
      }) => {
        onToolCall?.("prepareSupportRequest");
        if (!(await ownsPacket(sql, userId, packetId))) return NOT_YOURS;
        // DRAFT ONLY — never POSTs the support request. Consent + submit stay in
        // the existing consent-gated packet UI, which we deep-link to.
        return {
          ok: true,
          draft: {
            targetOrganization,
            requestedHelp,
            suggestedScopes: suggestedScopes ?? [],
          },
          note:
            "Here's a draft. Nothing is sent yet — open your packet, review it, tick the consent box, and submit the request yourself.",
          suggestion: resolveNavTarget(
            `/workspace/incentive-preparation/${packetId}`,
            "Review & submit in your packet"
          ),
        };
      },
    }),
  };
}

export type ConciergeActionTools = ReturnType<typeof buildConciergeActionTools>;

/** Names of the approval-gated action tools (for UI copy + tests). */
export const CONCIERGE_ACTION_TOOL_NAMES = [
  "updateBusinessProfile",
  "updatePacketTask",
  "createFoundationPacket",
  "selectPacketProgram",
  "prepareSupportRequest",
] as const;
