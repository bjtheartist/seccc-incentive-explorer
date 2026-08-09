import { NextRequest, NextResponse } from "next/server";
import {
  ElmsNotFoundError,
  ElmsUnavailableError,
  fetchElmsMatter,
} from "@/lib/zoning-legislation";

export const runtime = "nodejs";

const AVAILABLE_HEADERS = {
  "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
};

const UNAVAILABLE_HEADERS = {
  "Cache-Control": "private, no-store",
};

function validMatterId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function validRecordNumber(value: string): boolean {
  return /^[a-z]{1,4}\d{4}-[a-z0-9-]{1,24}$/i.test(value);
}

/**
 * Exact City Clerk matter lookup for a City-published matter id or record
 * number. This route does not search titles, infer parcel matches, or decide
 * whether a proposed use is permitted.
 */
export async function GET(request: NextRequest) {
  const matterId = request.nextUrl.searchParams.get("matterId")?.trim() ?? "";
  const recordNumber =
    request.nextUrl.searchParams.get("recordNumber")?.trim() ?? "";

  if (!matterId && !recordNumber) {
    return NextResponse.json(
      {
        status: "invalid_request",
        message: "Provide a City-published matterId or recordNumber.",
      },
      { status: 400, headers: UNAVAILABLE_HEADERS },
    );
  }
  if ((matterId && !validMatterId(matterId)) || (recordNumber && !validRecordNumber(recordNumber))) {
    return NextResponse.json(
      {
        status: "invalid_request",
        message: "The Clerk matter identifier is not valid.",
      },
      { status: 400, headers: UNAVAILABLE_HEADERS },
    );
  }

  try {
    const matter = await fetchElmsMatter({
      matterId: matterId || undefined,
      recordNumber: matterId ? undefined : recordNumber,
    });
    return NextResponse.json(
      {
        status: "available",
        matter,
        source: {
          id: "chicago-clerk-elms",
          label: "Chicago City Clerk Electronic Legislative Management System (eLMS)",
          coverage:
            "City Council legislative records. This is not the current zoning map or a permitted-use determination.",
        },
      },
      { headers: AVAILABLE_HEADERS },
    );
  } catch (error) {
    if (error instanceof ElmsNotFoundError) {
      return NextResponse.json(
        {
          status: "not_found",
          matter: null,
          message: "The City Clerk did not return that legislative matter.",
        },
        { status: 404, headers: UNAVAILABLE_HEADERS },
      );
    }
    console.error("[zoning-legislation] eLMS lookup failed", error);
    const message =
      error instanceof ElmsUnavailableError
        ? "The City Clerk legislative source is temporarily unavailable."
        : "The zoning legislation lookup could not be completed.";
    return NextResponse.json(
      { status: "unavailable", matter: null, message },
      { status: 503, headers: UNAVAILABLE_HEADERS },
    );
  }
}
