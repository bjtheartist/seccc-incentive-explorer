import { NextRequest, NextResponse } from "next/server";
import {
  OWNER_FILES_ADMIN_COOKIE,
  hasValidOwnerFilesAdminSession,
  isOwnerFilesAdminConfigured,
} from "@/lib/owner-files-admin-auth";
import { getSQL } from "@/lib/db";
import {
  OWNER_FILE_OUTREACH_EVENT_TYPES,
  OWNER_FILE_OUTREACH_OUTCOMES,
  addOutreachEvent,
  getOwnerCluster,
  getOwnerFileVerification,
  listOutreachEvents,
  type OwnerFileOutreachEventType,
  type OwnerFileOutreachOutcome,
} from "@/lib/owner-file";
import { resolveParcelProgramContext } from "@/lib/owner-file-letter-context";

type Params = { params: Promise<{ clusterKey: string }> };

function isAuthorized(req: NextRequest): boolean {
  return hasValidOwnerFilesAdminSession(req.cookies.get(OWNER_FILES_ADMIN_COOKIE)?.value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** GET /api/owner-file/[clusterKey]/outreach?zip= — the outreach event log for this cluster. */
export async function GET(req: NextRequest, { params }: Params) {
  if (!isOwnerFilesAdminConfigured()) {
    return NextResponse.json({ error: "Owner Files admin auth is not configured" }, { status: 503 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { clusterKey } = await params;
  const events = await listOutreachEvents(sql, clusterKey);
  return NextResponse.json({ events });
}

/**
 * POST /api/owner-file/[clusterKey]/outreach — log an outreach event.
 * `zip` and `eventType` are required. `letter_generated` and
 * `letter_downloaded` are gated on the cluster's current verification
 * having `status === "verified"` (the letter itself is generated from a
 * verified owner record only). `letter_generated` additionally resolves and
 * returns per-parcel incentive-program context (lib/owner-file-letter-
 * context.ts) so the client can build the PDF (lib/outreach-letter.ts)
 * immediately from this response.
 */
export async function POST(req: NextRequest, { params }: Params) {
  if (!isOwnerFilesAdminConfigured()) {
    return NextResponse.json({ error: "Owner Files admin auth is not configured" }, { status: 503 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { clusterKey } = await params;
  const body = await req.json().catch(() => null);
  if (!isRecord(body)) {
    return NextResponse.json({ error: "Request body is required" }, { status: 400 });
  }

  const zip = typeof body.zip === "string" ? body.zip.trim() : "";
  if (!/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: "zip must be a 5-digit ZIP code" }, { status: 400 });
  }

  const eventType = typeof body.eventType === "string" ? body.eventType : "";
  if (!OWNER_FILE_OUTREACH_EVENT_TYPES.includes(eventType as OwnerFileOutreachEventType)) {
    return NextResponse.json(
      { error: `eventType must be one of: ${OWNER_FILE_OUTREACH_EVENT_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  const outcome = body.outcome == null ? null : typeof body.outcome === "string" ? body.outcome : "";
  if (outcome !== null && !OWNER_FILE_OUTREACH_OUTCOMES.includes(outcome as OwnerFileOutreachOutcome)) {
    return NextResponse.json(
      { error: `outcome must be null or one of: ${OWNER_FILE_OUTREACH_OUTCOMES.join(", ")}` },
      { status: 400 }
    );
  }

  const verification = await getOwnerFileVerification(sql, clusterKey);

  const requiresVerified = eventType === "letter_generated" || eventType === "letter_downloaded";
  if (requiresVerified && verification?.status !== "verified") {
    return NextResponse.json(
      {
        error:
          "This cluster does not have a verified Owner File yet. Complete verification before generating or downloading an outreach letter.",
      },
      { status: 400 }
    );
  }

  const programIds = Array.isArray(body.programIds)
    ? body.programIds.filter((id): id is string => typeof id === "string")
    : [];
  const actorName = typeof body.actorName === "string" ? body.actorName.trim() || null : null;
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;

  const event = await addOutreachEvent(sql, {
    clusterKey,
    zip,
    verificationId: verification?.id ?? null,
    eventType: eventType as OwnerFileOutreachEventType,
    actorName,
    programIds,
    outcome: outcome as OwnerFileOutreachOutcome | null,
    notes,
  });

  if (eventType !== "letter_generated") {
    return NextResponse.json({ event });
  }

  const cluster = await getOwnerCluster(zip, clusterKey);
  const parcelProgramContext = cluster
    ? await resolveParcelProgramContext(cluster.sampleAddresses)
    : [];

  return NextResponse.json({ event, parcelProgramContext });
}
