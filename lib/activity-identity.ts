import "server-only";

import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/current-user";

/**
 * Who an analytics event or lead belongs to.
 *
 * Before this module, /api/events never resolved the signed-in user and no
 * browser identifier was kept, so all report_events rows had user_id NULL and
 * nothing tied anonymous activity to a later email. A CCLBA request (Oct 2026)
 * for "people who showed interest in these properties" could not be answered
 * from history for that reason.
 *
 * - `userId` is resolved server-side from the Auth.js session. The client body
 *   is never trusted for it.
 * - `anonymousId` is a random UUID in a first-party, HTTP-only cookie that the
 *   server issues. It identifies a browser, not a person. It links to a person
 *   only when that browser later submits an email (report_leads) or signs in.
 */

export const VISITOR_COOKIE = "cie_vid";
export const VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const VISITOR_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface ActivityIdentity {
  userId: string | null;
  anonymousId: string | null;
  /** True when anonymousId was minted on this request and must be set as a cookie. */
  issuedVisitorId: boolean;
}

/** A tampered or malformed cookie is treated as absent, never stored. */
export function readVisitorId(req: NextRequest): string | null {
  const value = req.cookies.get(VISITOR_COOKIE)?.value?.trim().toLowerCase();
  return value && VISITOR_ID_PATTERN.test(value) ? value : null;
}

/** Identity lookup must never block or fail an analytics write or a lead. */
async function currentUserIdOrNull(): Promise<string | null> {
  try {
    return await getCurrentUserId();
  } catch (error) {
    console.error("[activity-identity] session lookup failed:", error);
    return null;
  }
}

/**
 * `mintVisitorId` is for the events route only: it is the one place a new
 * browser identifier is created. Lead routes read the existing cookie so a
 * lead joins the activity that came before it, and they never issue one.
 */
export async function resolveActivityIdentity(
  req: NextRequest,
  { mintVisitorId = false }: { mintVisitorId?: boolean } = {},
): Promise<ActivityIdentity> {
  const existing = readVisitorId(req);
  const anonymousId = existing ?? (mintVisitorId ? randomUUID() : null);
  return {
    userId: await currentUserIdOrNull(),
    anonymousId,
    issuedVisitorId: !existing && anonymousId !== null,
  };
}

export function setVisitorCookie(res: NextResponse, anonymousId: string) {
  res.cookies.set(VISITOR_COOKIE, anonymousId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VISITOR_COOKIE_MAX_AGE_SECONDS,
  });
}
