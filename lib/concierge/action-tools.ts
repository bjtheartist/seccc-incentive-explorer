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
 *      checks). The merged Business File and program-selection routes are used
 *      directly, so tool inputs cannot drift from those API contracts.
 *
 * Boundary (re-asserted for actions): these tools PREPARE and ORGANIZE. They
 * never certify, submit, or send anything externally. `prepareSupportRequest`
 * saves an editable support-request draft for review. The consent checkbox and the
 * actual POST stay in the existing consent-gated packet UI, which this tool
 * deep-links to.
 */
import { tool } from "ai";
import { z } from "zod";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { isGoalType } from "@/lib/workspace";
import { getAllPrograms } from "@/lib/programs-data";
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
  /** Absolute origin (proto://host) for synthetic in-process route requests. */
  requestOrigin: string;
  /** The signed-in user's cookie header, forwarded to guarded route handlers. */
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

function canonicalProgram(programId: string, programName?: string | null) {
  const id = programId.trim();
  const name = programName?.trim().toLowerCase();
  return (
    getAllPrograms().find((program) => program.id === id) ??
    (name
      ? getAllPrograms().find(
          (program) => program.name.trim().toLowerCase() === name
        )
      : undefined)
  );
}

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
        "Update the state of an applicant-controlled task on an Incentive Preparedness Packet. REQUIRES the user's approval. Read the packet first and use only a status accepted by the packet API. Certification/submission tasks are protected and cannot be changed here.",
      inputSchema: z.object({
        packetId: z.string().max(200).describe("The packet id."),
        taskId: z.string().max(200).describe("The task id within the packet."),
        status: z
          .enum([
            "needs_document",
            "needs_owner_answer",
            "needs_advisor",
            "external_dependency",
            "complete",
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
        "Start a reusable Business File foundation for the signed-in owner, or start an Incentive Preparedness Packet for a specific sourced program and project goal. REQUIRES the user's approval. Omit programName, programId, and goalType for a foundation-only Business File; otherwise provide all three.",
      inputSchema: z.object({
        programName: z
          .string()
          .max(200)
          .optional()
          .describe("The sourced program name. Omit for a foundation-only Business File."),
        programId: z.string().max(120).optional().describe("Program id if known."),
        goalType: z
          .string()
          .max(60)
          .optional()
          .describe(
            "One of: improve-storefront, buy-equipment, hire-staff, expand-location, open-relocate, acquire-vacant-property, development-feasibility. Omit for a foundation-only Business File."
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
        const hasProgramIntent = Boolean(programName || programId || goalType);
        if (
          hasProgramIntent &&
          (!programName || !programId || !goalType || !isGoalType(goalType))
        ) {
          return {
            ok: false,
            note:
              "To start a program-specific packet I need a sourced program and one project goal. Ask the owner for the missing choice, then try again. A foundation-only Business File can be started without either.",
          };
        }
        const program = hasProgramIntent
          ? canonicalProgram(programId!, programName)
          : null;
        if (hasProgramIntent && !program) {
          return {
            ok: false,
            note:
              "I couldn't match that program to the Explorer's sourced program list, so I didn't create a packet.",
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
        // Compose with the same guarded creation route used by the workspace.
        const { POST: createPacket } = await import(
          "@/app/api/incentive-preparation/route"
        );
        const { status, json } = await callHandler(createPacket, {
          origin: requestOrigin,
          path: `/api/incentive-preparation`,
          method: "POST",
          cookieHeader,
          body: program
            ? {
                programName: program.name,
                programId: program.id,
                goalType,
                projectAddress,
                profileId,
              }
            : { projectAddress, profileId },
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
          note: program
            ? `Started your ${program.name} Incentive Preparedness Packet.`
            : "Started your reusable Business File foundation.",
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
        "Set the sourced program and project goal for a foundation-only Incentive Preparedness Packet. REQUIRES the user's approval. A packet that already targets a program cannot be repointed; start another packet instead.",
      inputSchema: z.object({
        packetId: z.string().max(200).describe("The packet id to update."),
        programId: z.string().max(120).describe("The program id to target."),
        programName: z.string().max(200).describe("The program name."),
        goalType: z
          .string()
          .max(60)
          .describe(
            "One of: improve-storefront, buy-equipment, hire-staff, expand-location, open-relocate, acquire-vacant-property, development-feasibility."
          ),
      }),
      needsApproval: true,
      execute: async ({ packetId, programId, programName, goalType }) => {
        onToolCall?.("selectPacketProgram");
        if (!(await ownsPacket(sql, userId, packetId))) return NOT_YOURS;
        if (!isGoalType(goalType)) {
          return {
            ok: false,
            note: "Choose one supported project goal before setting the program.",
          };
        }
        const program = canonicalProgram(programId, programName);
        if (!program) {
          return {
            ok: false,
            note:
              "I couldn't match that program to the Explorer's sourced program list, so I didn't change the packet.",
          };
        }

        const { PATCH: patchPacket } = await import(
          "@/app/api/incentive-preparation/[id]/route"
        );
        const { status, json } = await callHandler(patchPacket, {
          origin: requestOrigin,
          path: `/api/incentive-preparation/${packetId}`,
          method: "PATCH",
          cookieHeader,
          id: packetId,
          body: {
            programId: program.id,
            programName: program.name,
            goalType,
          },
        });
        if (status >= 400 || !json) {
          return {
            ok: false,
            note:
              (json?.error as string) ||
              "I couldn't set that program. Nothing was changed.",
          };
        }

        return {
          ok: true,
          packetId,
          programId: program.id,
          note: `Set this Incentive Preparedness Packet to ${program.name}.`,
          suggestion: resolveNavTarget(
            `/workspace/incentive-preparation/${packetId}`,
            "Open your packet"
          ),
        };
      },
    }),

    prepareSupportRequest: tool({
      description:
        "Prepare a local-support request for a packet, either for an introduction or 1:1 help reviewing assembled materials (which organization, what help, and which data to share). REQUIRES the user's approval. Use this only after the owner has enough context for a useful conversation and explicitly asks to continue. It never sends or schedules anything. The owner reviews the summary, chooses the data scope, gives consent, and records the request in the packet.",
      inputSchema: z.object({
        packetId: z.string().max(200).describe("The packet the request is for."),
        requestType: z
          .enum(["introduction", "materials_review"])
          .describe(
            "Use introduction for a local-partner handoff, or materials_review for direct 1:1 help reviewing assembled materials."
          ),
        targetOrganization: z
          .string()
          .max(200)
          .optional()
          .describe("The partner organization for an introduction. Omit for materials_review."),
        requestedHelp: z
          .string()
          .max(2000)
          .describe(
            "A concise project summary covering what the owner is working toward and any open questions. Do not include an eligibility, viability, or readiness conclusion."
          ),
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
        requestType,
        targetOrganization,
        requestedHelp,
        suggestedScopes,
      }) => {
        onToolCall?.("prepareSupportRequest");
        if (!(await ownsPacket(sql, userId, packetId))) return NOT_YOURS;
        const { PUT: putSupportRequestDraft } = await import(
          "@/app/api/incentive-preparation/[id]/support-request/draft/route"
        );
        const { status, json } = await callHandler(putSupportRequestDraft, {
          origin: requestOrigin,
          path: `/api/incentive-preparation/${packetId}/support-request/draft`,
          method: "PUT",
          cookieHeader,
          id: packetId,
          body: {
            requestType,
            targetOrganization,
            requestedHelp,
            suggestedScopes: suggestedScopes ?? [],
          },
        });
        if (status >= 400 || !json) {
          return {
            ok: false,
            note:
              (json?.error as string) ||
              "I couldn't save that support-request draft. Nothing was shared or scheduled.",
          };
        }
        // PREPARATION ONLY — the draft route never records consent or creates a
        // support request. Review and final recording stay in the packet UI.
        return {
          ok: true,
          draft: json.draft,
          note:
            "Your support-request draft is saved. Nothing was shared or scheduled. Open your packet to review it, choose what may be shared, and give consent only if you want to record the request.",
          suggestion: resolveNavTarget(
            `/workspace/incentive-preparation/${packetId}`,
            "Review your support request"
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
