import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadPermitExhibit } from "@/lib/permit-exhibit-source";
import {
  createPermitExhibitSnapshot,
  permitExhibitSnapshotClientIdentifier,
  PermitExhibitSnapshotStorageUnavailableError,
  reservePermitExhibitSnapshotCreate,
} from "@/lib/permit-exhibit-snapshot";
import {
  SHORTLIST_ACCESS_COOKIE,
  hasValidShortlistAccessSession,
} from "@/lib/shortlist-access";

export const dynamic = "force-dynamic";

const CreateSnapshotInput = z
  .object({
    pin: z.string().trim().regex(/^\d{14}$/),
    radiusFt: z.number().int().refine((value) => [250, 500, 1000].includes(value)),
    requestId: z.string().uuid(),
  })
  .strict();

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

function json(body: Record<string, unknown>, status: number, headers?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, ...headers },
  });
}

const BUILD_ERROR: Record<string, { status: number; message: string }> = {
  invalid_pin: { status: 400, message: "That does not look like a 14-digit Cook County PIN." },
  parcel_not_found: { status: 404, message: "No parcel record was found for that PIN." },
  parcel_source_unavailable: {
    status: 503,
    message: "The parcel source is temporarily unavailable. Try again shortly.",
  },
  parcel_geometry_unavailable: {
    status: 503,
    message: "The parcel boundary is temporarily unavailable. Try again shortly.",
  },
  database_unavailable: {
    status: 503,
    message: "Permit records are temporarily unavailable. Try again shortly.",
  },
  unavailable: {
    status: 503,
    message: "The exhibit could not be assembled right now. Try again shortly.",
  },
};

/** Create an immutable snapshot from server-owned evidence only. */
export async function POST(request: NextRequest) {
  if (!hasValidShortlistAccessSession(request.cookies.get(SHORTLIST_ACCESS_COOKIE)?.value)) {
    return json({ error: "Your exhibit access has expired. Refresh the page and sign up again." }, 401);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "Send a valid JSON request." }, 400);
  }
  const parsed = CreateSnapshotInput.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "This exhibit request is invalid. Refresh the page and try again." }, 400);
  }

  try {
    const reservation = await reservePermitExhibitSnapshotCreate(
      permitExhibitSnapshotClientIdentifier(request.headers),
    );
    if (!reservation.allowed) {
      return json(
        { error: "Too many snapshots were saved recently. Please try again in about an hour." },
        429,
        { "Retry-After": String(reservation.retryAfterSeconds) },
      );
    }

    const result = await loadPermitExhibit({
      pin: parsed.data.pin,
      radiusFt: parsed.data.radiusFt,
    });
    if (!result.ok) {
      const failure = BUILD_ERROR[result.error.kind] ?? BUILD_ERROR.unavailable;
      return json({ error: failure.message }, failure.status);
    }

    const snapshot = await createPermitExhibitSnapshot({
      exhibit: result.data,
      requestId: parsed.data.requestId,
    });
    return json(
      {
        publicId: snapshot.publicId,
        displayId: snapshot.displayId,
        url: `/permit-exhibit/snapshots/${snapshot.publicId}`,
      },
      201,
    );
  } catch (error) {
    if (error instanceof PermitExhibitSnapshotStorageUnavailableError) {
      return json(
        { error: "Snapshot storage is temporarily unavailable. Your live exhibit was not changed." },
        503,
      );
    }
    console.error("Permit exhibit snapshot save failed:", error);
    return json({ error: "The snapshot could not be saved right now. Please try again." }, 503);
  }
}
