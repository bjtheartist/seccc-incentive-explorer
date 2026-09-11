import "server-only";
import { getCurrentUserId } from "@/lib/current-user";
import { requireSQL } from "@/lib/db";
import type { Member } from "./model";

export class GrantsError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function getGrantsMember(): Promise<Member | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const sql = requireSQL();
  // Bootstrap by immutable account ID, never by an unverified signup email.
  const owner = process.env.GRANTS_OWNER_USER_ID?.trim();
  const rows = await sql`
    SELECT u.id, u.name, u.email, m.role, m.active FROM users u
    LEFT JOIN grants_members m ON m.user_id=u.id WHERE u.id=${userId} LIMIT 1
  `;
  const row = rows[0];
  if (!row || (userId !== owner && !row.active)) return null;
  const role = userId === owner ? "owner" : row.role;
  if (!["owner", "editor", "viewer"].includes(role)) return null;
  return {
    userId,
    name: row.name || row.email || "Team member",
    email: row.email || "",
    role,
  };
}
export async function requireGrantsMember(write = false, owner = false) {
  const member = await getGrantsMember();
  if (!member) throw new GrantsError("Staff access required", 403);
  if ((write && member.role === "viewer") || (owner && member.role !== "owner"))
    throw new GrantsError(
      "You do not have permission to make this change",
      403,
    );
  return member;
}
export function assertSameOrigin(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    throw new GrantsError("Same-origin request required", 403);
}
