import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireGrantsMember,
  assertSameOrigin,
  GrantsError,
} from "@/lib/grants/auth";
import { GrantsCatalog } from "@/lib/grants/catalog";
import { catalogQuerySchema } from "@/lib/grants/catalog-model";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
const failure = (e: unknown) =>
  response(
    {
      error:
        e instanceof GrantsError
          ? e.message
          : e instanceof z.ZodError
            ? "Invalid catalog query"
            : "The funding database is unavailable. Retry after the catalog migration and import are complete.",
    },
    e instanceof GrantsError ? e.status : e instanceof z.ZodError ? 400 : 503,
  );
const idSchema = z.string().min(1).max(200);
export async function GET(req: Request) {
  try {
    await requireGrantsMember();
    const params = new URL(req.url).searchParams,
      catalog = new GrantsCatalog();
    if (params.has("id"))
      return response(await catalog.get(idSchema.parse(params.get("id"))));
    if (params.has("applicantId"))
      return response(
        await catalog.suggest(idSchema.parse(params.get("applicantId"))),
      );
    return response(
      await catalog.list(catalogQuerySchema.parse(Object.fromEntries(params))),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const member = await requireGrantsMember(true);
    const raw = await req.text();
    if (raw.length > 2000) throw new GrantsError("Request is too large", 413);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new GrantsError("Invalid JSON");
    }
    const { id } = z.object({ id: idSchema }).parse(parsed);
    return response(await new GrantsCatalog().promote(id, member));
  } catch (e) {
    return failure(e);
  }
}
