import { NextRequest, NextResponse } from "next/server";
import {
  OWNER_FILES_ADMIN_COOKIE,
  hasValidOwnerFilesAdminSession,
  isOwnerFilesAdminConfigured,
} from "@/lib/owner-files-admin-auth";
import { getSQL } from "@/lib/db";
import { loadStaticOwnerClustersGeneratedAt } from "@/lib/corridor-owners";
import { resolveConfidenceTier } from "@/lib/owner-confidence";
import { normalizeChecklist } from "@/lib/workspace";
import {
  OWNER_FILE_NOTE_TYPES,
  OWNER_FILE_VERIFICATION_STATUSES,
  addOwnerFileNote,
  getOwnerCluster,
  listOwnerFileNotes,
  upsertOwnerFileVerification,
  type OwnerFileNoteType,
  type OwnerFileVerificationStatus,
} from "@/lib/owner-file";

type Params = { params: Promise<{ clusterKey: string }> };

function isAuthorized(req: NextRequest): boolean {
  return hasValidOwnerFilesAdminSession(req.cookies.get(OWNER_FILES_ADMIN_COOKIE)?.value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trimmedStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * POST /api/owner-file/[clusterKey]/verification — upsert-by-cluster_key
 * (lib/owner-file.ts upsertOwnerFileVerification), including checklist
 * updates. Requires `zip` and `verifierName`. Gated behind the Owner Files
 * admin session.
 *
 * `confidenceTier` is never accepted from the request body — it is always
 * server-computed via resolveConfidenceTier ("computed, not asserted" per
 * the plan's governance rails) from the resolved cluster, the incoming
 * status/il_sos_lookup_url, and any notes on file (including one optionally
 * created in this same request via the `note` field — the guided
 * individual IL-SOS-lookup paste-back).
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

  const { clusterKey: rawClusterKey } = await params;
  const clusterKey = decodeURIComponent(rawClusterKey);
  const body = await req.json().catch(() => null);
  if (!isRecord(body)) {
    return NextResponse.json({ error: "Request body is required" }, { status: 400 });
  }

  const zip = typeof body.zip === "string" ? body.zip.trim() : "";
  if (!/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: "zip must be a 5-digit ZIP code" }, { status: 400 });
  }

  const verifierName = trimmedStringOrNull(body.verifierName);
  if (!verifierName) {
    return NextResponse.json({ error: "verifierName is required" }, { status: 400 });
  }
  if (verifierName.length > 200) {
    return NextResponse.json({ error: "verifierName must be ≤ 200 characters" }, { status: 400 });
  }

  const status = typeof body.status === "string" ? body.status : "draft";
  if (!OWNER_FILE_VERIFICATION_STATUSES.includes(status as OwnerFileVerificationStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${OWNER_FILE_VERIFICATION_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  // IL-SOS free-text fields — capped at 500 chars each, matching the other
  // length caps on this route (verifierName, note.body/sourceUrl below).
  const registeredAgentName = trimmedStringOrNull(body.registeredAgentName);
  const registeredAgentAddress = trimmedStringOrNull(body.registeredAgentAddress);
  const ilSosFileNumber = trimmedStringOrNull(body.ilSosFileNumber);
  const ilSosLookupUrl = trimmedStringOrNull(body.ilSosLookupUrl);
  const ilSosFields: [string, string | null][] = [
    ["registeredAgentName", registeredAgentName],
    ["registeredAgentAddress", registeredAgentAddress],
    ["ilSosFileNumber", ilSosFileNumber],
    ["ilSosLookupUrl", ilSosLookupUrl],
  ];
  for (const [label, value] of ilSosFields) {
    if (value && value.length > 500) {
      return NextResponse.json({ error: `${label} must be ≤ 500 characters` }, { status: 400 });
    }
  }

  const cluster = await getOwnerCluster(zip, clusterKey);
  if (!cluster) {
    return NextResponse.json(
      { error: "No owner cluster found for this zip/clusterKey" },
      { status: 404 }
    );
  }

  // Optional entity-lookup (or other) note submitted alongside the
  // verification — the guided single-lookup paste-back trail (bulk IL SOS
  // access is prohibited; this is the honest alternative).
  let createdNote = null;
  if (isRecord(body.note)) {
    const noteType = typeof body.note.noteType === "string" ? body.note.noteType : "";
    const noteBody = trimmedStringOrNull(body.note.body);
    const noteSourceUrl = trimmedStringOrNull(body.note.sourceUrl);
    if (!OWNER_FILE_NOTE_TYPES.includes(noteType as OwnerFileNoteType)) {
      return NextResponse.json(
        { error: `note.noteType must be one of: ${OWNER_FILE_NOTE_TYPES.join(", ")}` },
        { status: 400 }
      );
    }
    if (!noteBody) {
      return NextResponse.json({ error: "note.body is required when note is provided" }, { status: 400 });
    }
    if (noteBody.length > 5000) {
      return NextResponse.json({ error: "note.body must be ≤ 5000 characters" }, { status: 400 });
    }
    if (noteSourceUrl && noteSourceUrl.length > 500) {
      return NextResponse.json({ error: "note.sourceUrl must be ≤ 500 characters" }, { status: 400 });
    }
    createdNote = await addOwnerFileNote(sql, {
      clusterKey,
      zip,
      authorName: verifierName,
      noteType: noteType as OwnerFileNoteType,
      body: noteBody,
      sourceUrl: noteSourceUrl,
    });
  }

  const notes = await listOwnerFileNotes(sql, clusterKey);
  const confidenceTier = resolveConfidenceTier(cluster, { status, ilSosLookupUrl }, notes);

  const verification = await upsertOwnerFileVerification(sql, {
    clusterKey,
    zip,
    pinsSnapshot: cluster.pins,
    ownerNameSnapshot: cluster.ownerName,
    ownerMailingAddressSnapshot: cluster.ownerMailingAddress,
    exportGeneratedAt: loadStaticOwnerClustersGeneratedAt(),
    verifierName,
    confidenceTier,
    registeredAgentName,
    registeredAgentAddress,
    ilSosFileNumber,
    ilSosLookupUrl,
    taxpayerMailingAddressConfirmed:
      typeof body.taxpayerMailingAddressConfirmed === "boolean"
        ? body.taxpayerMailingAddressConfirmed
        : null,
    localVsAbsentee: trimmedStringOrNull(body.localVsAbsentee),
    checklist: normalizeChecklist(body.checklist),
    status: status as OwnerFileVerificationStatus,
  });

  return NextResponse.json({ verification, note: createdNote, resolvedTier: confidenceTier });
}
