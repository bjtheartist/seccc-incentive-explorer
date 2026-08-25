import { NextRequest, NextResponse } from "next/server";
import { PublicInvestmentEarlyAccessSchema } from "@/lib/public-investment-early-access";
import {
  PublicInvestmentEarlyAccessStorageUnavailableError,
  publicInvestmentEarlyAccessClientIdentifier,
  reservePublicInvestmentEarlyAccessRequest,
  savePublicInvestmentEarlyAccessRequest,
} from "@/lib/public-investment-early-access-storage";

export const runtime = "nodejs";

function json(body: Record<string, unknown>, status = 200, headers?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (typeof body?.website === "string" && body.website.trim()) {
      return json({ success: true });
    }

    const parsed = PublicInvestmentEarlyAccessSchema.safeParse(body);
    if (!parsed.success) {
      return json(
        {
          error: "Please check your name, title, and email address.",
          fields: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const reservation = await reservePublicInvestmentEarlyAccessRequest(
      publicInvestmentEarlyAccessClientIdentifier(request.headers),
    );
    if (!reservation.allowed) {
      return json(
        { error: "Too many requests. Please try again later." },
        429,
        { "Retry-After": String(reservation.retryAfterSeconds) },
      );
    }

    await savePublicInvestmentEarlyAccessRequest(parsed.data);
    return json({ success: true, message: "Your early-access request is recorded." });
  } catch (error) {
    if (error instanceof PublicInvestmentEarlyAccessStorageUnavailableError) {
      return json({ error: "Early-access signup is temporarily unavailable." }, 503);
    }
    console.error("Public Investment early-access signup failed:", error);
    return json({ error: "We could not save your request. Please try again." }, 500);
  }
}
