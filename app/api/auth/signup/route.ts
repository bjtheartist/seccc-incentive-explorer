import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import {
  hashPassword,
  isStrongEnoughPassword,
  normalizeEmail,
} from "@/lib/password";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const sql = getSQL();
  if (!sql) {
    return NextResponse.json(
      { error: "Email signup requires DATABASE_URL." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const email =
    typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 }
    );
  }

  if (!isStrongEnoughPassword(password)) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  const existing = await sql`
    SELECT id, password_hash
    FROM users
    WHERE lower(email) = ${email}
    LIMIT 1
  `;

  if (existing.length > 0) {
    return NextResponse.json(
      { error: "An account already exists for that email." },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(password);
  await sql`
    INSERT INTO users (name, email, "emailVerified", image, password_hash)
    VALUES (${name || null}, ${email}, NOW(), null, ${passwordHash})
  `;

  return NextResponse.json({ ok: true }, { status: 201 });
}
