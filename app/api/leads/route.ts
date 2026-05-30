import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { recordReportEvent } from "@/lib/server-analytics";

export async function POST(req: NextRequest) {
  try {
    const { name, email, zipCode, reportAddress, reportTitle } = await req.json();

    if (!name || !email || !zipCode) {
      return NextResponse.json(
        { error: "Name, email, and zip code are required" },
        { status: 400 }
      );
    }

    const sql = getSQL();
    if (sql) {
      // Create table if it doesn't exist
      await sql`
        CREATE TABLE IF NOT EXISTS report_leads (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          zip_code TEXT NOT NULL,
          report_address TEXT,
          report_title TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `;

      await sql`
        INSERT INTO report_leads (name, email, zip_code, report_address, report_title)
        VALUES (${name}, ${email}, ${zipCode}, ${reportAddress || null}, ${reportTitle || null})
      `;
    }

    await recordReportEvent("inquiry_submitted", {
      source: "download_gate",
      address: reportAddress || null,
      metadata: {
        reportTitle: reportTitle || null,
        zipCode: zipCode || null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Lead capture error:", err);
    return NextResponse.json(
      { error: "Failed to save" },
      { status: 500 }
    );
  }
}
