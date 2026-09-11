import "server-only";
import { randomUUID } from "node:crypto";
import { requireSQL } from "@/lib/db";
import { GrantsError } from "./auth";
import {
  schemas,
  screenMatch,
  matchNeedsReview,
  type Resource,
  type GrantRecord,
  type Member,
  type Applicant,
  type Round,
  type Match,
  type WorkspaceData,
} from "./model";

export type Row = Record<string, unknown>;
export type Query = (query: string, params?: unknown[]) => Promise<Row[]>;
export const query: Query = async (q, params = []) =>
  (await requireSQL().query(q, params)) as Row[];
const tables: Record<Resource, string> = {
  programs: "grants_programs",
  rounds: "grants_rounds",
  applicants: "grants_applicants",
  sources: "grants_sources",
  matches: "grants_matches",
};
const iso = (value: unknown) =>
  value ? new Date(String(value)).toISOString() : null;
export function record<T>(row: Row): GrantRecord<T> {
  return {
    id: String(row.id),
    data: row.data as T,
    version: Number(row.version),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    updatedBy: String(row.updated_by),
  };
}

export class GrantsStore {
  constructor(private sql: Query = query) {}
  async get<T>(resource: Resource, id: string) {
    const rows = await this.sql(
      `SELECT * FROM ${tables[resource]} WHERE id=$1`,
      [id],
    );
    if (!rows[0]) throw new GrantsError("Record not found", 404);
    return record<T>(rows[0]);
  }
  async list(resource: Resource) {
    const rows = await this.sql(
      `SELECT * FROM ${tables[resource]} ORDER BY updated_at DESC`,
    );
    return rows.map((row) => record(row));
  }
  async save(
    resource: Resource,
    input: unknown,
    member: Member,
    id?: string,
    version?: number,
  ) {
    const parsed = schemas[resource].safeParse(input);
    if (!parsed.success)
      throw new GrantsError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      );
    const data = parsed.data;
    if (data.ownerId) {
      const owners = await this.sql(
        "SELECT user_id FROM grants_members WHERE user_id=$1 AND active=TRUE",
        [data.ownerId],
      );
      if (!owners.length && data.ownerId !== process.env.GRANTS_OWNER_USER_ID)
        throw new GrantsError("Choose an active team member as owner");
    }
    if (resource === "matches") {
      const m = data as Match;
      const [a, r] = await Promise.all([
        this.get<Applicant>("applicants", m.applicantId),
        this.get<Round>("rounds", m.roundId),
      ]);
      if (m.roundVersion !== r.version || m.applicantVersion !== a.version)
        throw new GrantsError(
          "Applicant or round changed. Reload before reviewing this match.",
          409,
        );
      const screening = screenMatch(a.data, r.data);
      const program = await this.get<{ archived: boolean }>(
        "programs",
        r.data.programId,
      );
      if (
        m.status === "approved" &&
        (a.data.archived ||
          program.data.archived ||
          matchNeedsReview(m, a, r) ||
          screening.exclusions.length ||
          !m.rationale.trim() ||
          !m.nextAction.trim())
      ) {
        throw new GrantsError(
          "Approval needs a current verified round, an active applicant and program, no screening exclusions, rationale and next action",
        );
      }
      if (m.status === "approved" && screening.gaps.length && !m.notes.trim())
        throw new GrantsError(
          "Document how the remaining screening questions were resolved before approval",
        );
    }
    let rows: Row[];
    if (id) {
      if (!Number.isInteger(version) || Number(version) < 1)
        throw new GrantsError("Record version is required");
      const scanReset =
        resource === "sources"
          ? ",next_scan_at=now(),last_status='pending',lease_until=NULL,lease_token=NULL"
          : "";
      rows = await this.sql(
        `UPDATE ${tables[resource]} SET data=$1::jsonb,version=version+1,updated_at=now(),updated_by=$2${scanReset} WHERE id=$3 AND version=$4 RETURNING *`,
        [JSON.stringify(data), member.userId, id, version],
      );
      if (!rows.length)
        throw new GrantsError(
          "Someone changed this record. Reload to preserve their edits.",
          409,
        );
    } else {
      rows = await this.sql(
        `INSERT INTO ${tables[resource]}(id,data,updated_by) VALUES($1,$2::jsonb,$3) RETURNING *`,
        [randomUUID(), JSON.stringify(data), member.userId],
      );
    }
    return record(rows[0]);
  }
  async workspace(member: Member): Promise<WorkspaceData> {
    const [
      programs,
      rounds,
      applicants,
      sources,
      matches,
      findings,
      health,
      members,
      activity,
    ] = await Promise.all([
      this.list("programs"),
      this.list("rounds"),
      this.list("applicants"),
      this.list("sources"),
      this.list("matches"),
      this.sql(
        "SELECT f.*,s.data->>'name' AS source_name FROM grants_findings f JOIN grants_sources s ON s.id=f.source_id WHERE f.state='pending' ORDER BY f.created_at DESC LIMIT 250",
      ),
      this.sql(
        "SELECT id,checked_at,next_scan_at,last_status,last_error FROM grants_sources",
      ),
      this.sql(
        "SELECT u.id,u.name,u.email,m.role FROM grants_members m JOIN users u ON u.id=m.user_id WHERE m.active=TRUE ORDER BY u.name",
      ),
      this.sql(
        "SELECT id,resource,record_id,action,actor,at FROM grants_activity ORDER BY id DESC LIMIT 100",
      ),
    ]);
    const team = members.map((r) => ({
      userId: String(r.id),
      name: String(r.name || r.email || "Team member"),
      email: String(r.email || ""),
      role: r.role as Member["role"],
    }));
    if (!team.some((m) => m.userId === member.userId)) team.push(member);
    return {
      programs,
      rounds,
      applicants,
      sources,
      matches,
      findings: findings.map((r) => ({
        id: String(r.id),
        sourceId: String(r.source_id),
        sourceName: String(r.source_name),
        url: String(r.url),
        title: String(r.title),
        kind: r.kind,
        excerpt: String(r.excerpt),
        previousExcerpt: r.previous_excerpt ? String(r.previous_excerpt) : null,
        snapshotId: String(r.snapshot_id),
        state: r.state,
        createdAt: iso(r.created_at),
      })),
      sourceHealth: health.map((r) => ({
        id: String(r.id),
        checkedAt: iso(r.checked_at),
        nextScanAt: iso(r.next_scan_at),
        lastStatus: r.last_status,
        lastError: r.last_error,
      })),
      members: team,
      activity: activity.map((r) => ({
        id: String(r.id),
        resource: String(r.resource).replace("grants_", ""),
        recordId: r.record_id,
        action: r.action,
        actor: r.actor,
        at: iso(r.at),
      })),
      member,
      scheduledScanning:
        process.env.VERCEL_ENV === "production" &&
        process.env.GRANTS_SCAN_ENABLED === "true",
    } as WorkspaceData;
  }
  async reviewFinding(
    id: string,
    action: "dismissed" | "converted",
    programId: string | null,
    member: Member,
  ) {
    if (action === "converted" && !programId)
      throw new GrantsError("Choose the program this finding belongs to");
    const rows = await this.sql(
      `WITH changed AS (
      UPDATE grants_findings SET state=$2,program_id=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1 AND state='pending' RETURNING *
    ), audit AS (
      INSERT INTO grants_activity(resource,record_id,action,actor,after_data) SELECT 'findings',id,$2,$4,jsonb_build_object('programId',$3::text) FROM changed
    ) SELECT id FROM changed`,
      [id, action, programId, member.userId],
    );
    if (!rows.length)
      throw new GrantsError(
        "This finding was already reviewed. Reload the queue.",
        409,
      );
  }
  async setMember(
    userId: string,
    role: Member["role"],
    active: boolean,
    actor: Member,
  ) {
    if (userId === process.env.GRANTS_OWNER_USER_ID || userId === actor.userId)
      throw new GrantsError("Owner access cannot be removed here");
    await this.sql(
      `WITH changed AS (
      INSERT INTO grants_members(user_id,role,active) VALUES($1,$2,$3)
      ON CONFLICT(user_id) DO UPDATE SET role=$2,active=$3,updated_at=now() RETURNING *
    ) INSERT INTO grants_activity(resource,record_id,action,actor,after_data)
      SELECT 'members',user_id,'access_changed',$4,jsonb_build_object('role',role,'active',active) FROM changed`,
      [userId, role, active, actor.userId],
    );
  }
}
