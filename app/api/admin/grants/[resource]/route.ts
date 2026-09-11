import { NextResponse } from "next/server";
import { z } from "zod";
import {
  assertSameOrigin,
  GrantsError,
  requireGrantsMember,
} from "@/lib/grants/auth";
import { GrantsStore, query } from "@/lib/grants/store";
import { schemas, type Resource } from "@/lib/grants/model";
import { canonicalUrl } from "@/lib/grants/fetch-source";
import { scanSources } from "@/lib/grants/scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};
const response = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers });
const store = () => new GrantsStore();
type Context = { params: Promise<{ resource: string }> };
function failure(error: unknown) {
  if (error instanceof GrantsError)
    return response({ error: error.message }, error.status);
  if (error instanceof z.ZodError)
    return response(
      { error: error.issues.map((i) => i.message).join("; ") },
      400,
    );
  const code = (error as { code?: string })?.code;
  if (code === "23505")
    return response(
      {
        error:
          "This record already exists. Open the existing record to update it.",
      },
      409,
    );
  if (code === "23503")
    return response(
      {
        error:
          "A linked account or record no longer exists. Reload and try again.",
      },
      400,
    );
  console.error(
    "Grants workspace request failed",
    code || "configuration-or-query-error",
  );
  return response(
    {
      error:
        "Grants workspace unavailable. Check the database connection and grants migration.",
    },
    503,
  );
}
export async function GET(req: Request, ctx: Context) {
  try {
    const member = await requireGrantsMember();
    const { resource } = await ctx.params;
    if (resource === "access") return response({ member });
    if (resource === "workspace")
      return response(await store().workspace(member));
    if (resource === "export")
      return new Response(
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            ...(await store().workspace(member)),
          },
          null,
          2,
        ),
        {
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "Content-Disposition":
              'attachment; filename="grants-workspace.json"',
          },
        },
      );
    if (resource === "snapshot") {
      const id = new URL(req.url).searchParams.get("id");
      const rows = await query(
        "SELECT id,url,content,content_hash,fetched_at FROM grants_snapshots WHERE id=$1",
        [id],
      );
      if (!rows.length) throw new GrantsError("Snapshot not found", 404);
      return response(rows[0]);
    }
    if (resource === "accounts") {
      await requireGrantsMember(false, true);
      const email = z.email().parse(new URL(req.url).searchParams.get("email"));
      const rows = await query(
        'SELECT id,name,email,"emailVerified" FROM users WHERE lower(email)=lower($1) LIMIT 2',
        [email],
      );
      return response({ accounts: rows });
    }
    throw new GrantsError("Unknown resource", 404);
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: Request, ctx: Context) {
  try {
    assertSameOrigin(req);
    const member = await requireGrantsMember(true);
    const { resource } = await ctx.params;
    const raw = await req.text();
    if (raw.length > 80_000) throw new GrantsError("Record is too large", 413);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      throw new GrantsError("Invalid JSON");
    }
    if (resource in schemas && Object.hasOwn(schemas, resource)) {
      const envelope = z
        .object({
          id: z.string().max(200).optional(),
          version: z.number().int().positive().optional(),
          data: z.record(z.string(), z.unknown()),
        })
        .parse(body);
      const data = { ...envelope.data };
      try {
        if (typeof data.sourceUrl === "string")
          data.sourceUrl = canonicalUrl(data.sourceUrl);
        if (typeof data.url === "string") data.url = canonicalUrl(data.url);
      } catch {
        throw new GrantsError("Enter a valid source URL");
      }
      return response({
        record: await store().save(
          resource as Resource,
          data,
          member,
          envelope.id,
          envelope.version,
        ),
      });
    }
    if (resource === "scan") return response(await scanSources());
    if (resource === "findings") {
      const b = z
        .object({
          id: z.string(),
          action: z.enum(["dismissed", "converted"]),
          programId: z.string().nullable().default(null),
        })
        .parse(body);
      await store().reviewFinding(b.id, b.action, b.programId, member);
      return response({ ok: true });
    }
    if (resource === "members") {
      await requireGrantsMember(true, true);
      const b = z
        .object({
          userId: z.string().min(1),
          role: z.enum(["editor", "viewer"]),
          active: z.boolean(),
        })
        .parse(body);
      await store().setMember(b.userId, b.role, b.active, member);
      return response({ ok: true });
    }
    throw new GrantsError("Unknown resource", 404);
  } catch (error) {
    return failure(error);
  }
}
