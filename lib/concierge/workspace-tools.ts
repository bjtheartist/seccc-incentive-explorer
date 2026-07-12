import { tool } from "ai";
import { z } from "zod";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import {
  canApplicantUpdateTask,
  normalizePreparationTasks,
} from "@/lib/incentive-preparation";

type SQL = NeonQueryFunction<false, false>;
type DatabaseRow = Record<string, unknown>;

export interface ConciergeWorkspaceToolDeps {
  userId: string;
  sql: SQL;
  onToolCall?: (toolName: string) => void;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateTime(value: unknown): string | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function profileView(row: DatabaseRow) {
  const fields = {
    legalName: textValue(row.legal_name),
    dbaName: textValue(row.dba_name),
    physicalAddress: textValue(row.physical_address),
    mailingAddress: textValue(row.mailing_address),
    contactName: textValue(row.contact_name),
    contactEmail: textValue(row.contact_email),
    contactPhone: textValue(row.contact_phone),
    entityType: textValue(row.entity_type),
    formationDate: textValue(row.formation_date)?.slice(0, 10) ?? null,
    industry: textValue(row.industry),
    naicsCode: textValue(row.naics_code),
    employeeCount: numberValue(row.employee_count),
  };

  return {
    id: String(row.id),
    businessName: fields.dbaName || fields.legalName || "Business File",
    fields,
    missingFields: Object.entries(fields)
      .filter(([, value]) => value === null)
      .map(([key]) => key),
    updatedAt: dateTime(row.updated_at),
  };
}

function packetView(row: DatabaseRow) {
  const tasks = normalizePreparationTasks(parseJson(row.tasks_json));
  return {
    id: String(row.id),
    businessProfileId: textValue(row.business_profile_id),
    title: textValue(row.title) || "Incentive Preparedness Packet",
    programId: textValue(row.program_id),
    programName: textValue(row.program_name),
    goalType: textValue(row.goal_type),
    projectAddress: textValue(row.project_address),
    status: textValue(row.status),
    taskCounts: {
      total: tasks.length,
      complete: tasks.filter((task) => task.status === "complete").length,
      protected: tasks.filter((task) => !canApplicantUpdateTask(task)).length,
    },
    updatedAt: dateTime(row.updated_at),
  };
}

/**
 * Signed-in, read-only workspace tools. Queries are always scoped to the
 * current session user. They expose the user's own saved facts and packet task
 * state, never internal fit scores, rankings, or modeled dollar estimates.
 */
export function buildConciergeWorkspaceTools({
  userId,
  sql,
  onToolCall,
}: ConciergeWorkspaceToolDeps) {
  return {
    getWorkspaceOverview: tool({
      description:
        "Read the signed-in owner's Business Files and Incentive Preparedness Packets. Use this before proposing a profile or packet action. Returns only owner-scoped saved facts and task counts; it never returns internal scores or dollar estimates.",
      inputSchema: z.object({}),
      execute: async () => {
        onToolCall?.("getWorkspaceOverview");
        const [profileRows, packetRows] = await Promise.all([
          sql`
            SELECT
              id, legal_name, dba_name, physical_address, mailing_address,
              contact_name, contact_email, contact_phone, entity_type,
              formation_date, industry, naics_code, employee_count, updated_at
            FROM business_profiles
            WHERE user_id = ${userId}
            ORDER BY updated_at DESC
            LIMIT 12
          `,
          sql`
            SELECT
              id, business_profile_id, title, program_id, program_name,
              goal_type, project_address, status, tasks_json, updated_at
            FROM incentive_preparation_packets
            WHERE user_id = ${userId}
            ORDER BY updated_at DESC
            LIMIT 20
          `,
        ]);

        return {
          profiles: profileRows.map((row) => profileView(row as DatabaseRow)),
          packets: packetRows.map((row) => packetView(row as DatabaseRow)),
          note:
            "These are the owner's saved records. Missing fields are not eligibility findings, and packet status is preparation progress only.",
        };
      },
    }),

    getPreparationPacket: tool({
      description:
        "Read one signed-in owner's Incentive Preparedness Packet and its tasks. Omit packetId for the most recently updated packet. Use applicantCanUpdate before proposing a task update; protected certification and submission tasks must never be changed by the guide.",
      inputSchema: z.object({
        packetId: z
          .string()
          .max(200)
          .optional()
          .describe("Owned packet id. Omit for the most recently updated packet."),
      }),
      execute: async ({ packetId }) => {
        onToolCall?.("getPreparationPacket");
        const rows = packetId
          ? await sql`
              SELECT *
              FROM incentive_preparation_packets
              WHERE id = ${packetId} AND user_id = ${userId}
              LIMIT 1
            `
          : await sql`
              SELECT *
              FROM incentive_preparation_packets
              WHERE user_id = ${userId}
              ORDER BY updated_at DESC
              LIMIT 1
            `;

        if (rows.length === 0) {
          return {
            found: false,
            note: "No matching packet was found under this account. Nothing was changed.",
          };
        }

        const row = rows[0] as DatabaseRow;
        const tasks = normalizePreparationTasks(parseJson(row.tasks_json));
        return {
          found: true,
          packet: {
            ...packetView(row),
            tasks: tasks.map((task) => ({
              id: task.id,
              title: task.title,
              description: task.description,
              status: task.status,
              owner: task.owner,
              category: task.category,
              applicantCanUpdate: canApplicantUpdateTask(task),
              estimatedWeeks: {
                min: task.estimatedMinWeeks,
                max: task.estimatedMaxWeeks,
              },
            })),
          },
          note:
            "This is preparation progress, not an eligibility or award determination. Protected tasks remain with the applicant or authorized representative.",
        };
      },
    }),
  };
}

export type ConciergeWorkspaceTools = ReturnType<
  typeof buildConciergeWorkspaceTools
>;
