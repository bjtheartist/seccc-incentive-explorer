import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  ANALYTICS_ADMIN_COOKIE,
  hasValidAnalyticsAdminSession,
  isAnalyticsAdminConfigured,
} from "@/lib/analytics-admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function gate(content: string, status: number) {
  return new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CTC Small Business Research | Chicago Incentive Explorer</title><style>body{margin:0;background:#f7f8fa;color:#0c1b33;font:16px/1.6 system-ui,sans-serif}main{max-width:460px;margin:10vh auto;padding:32px;background:white;border:1px solid #dce1e8}h1{font-size:30px;line-height:1.2}a{color:#2563eb}label,input,button{display:block}input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:8px;font:inherit}button{background:#0c1b33;color:white;border:0;cursor:pointer}.eyebrow{font-size:12px;letter-spacing:.1em;text-transform:uppercase}.error{color:#b91c1c}@media(max-width:540px){main{margin:24px 16px;padding:24px}}</style></head><body><main><a href="/">Chicago Incentive Explorer</a><p class="eyebrow">Internal working material</p><h1>CTC Small Business Research</h1>${content}</main></body></html>`, { status, headers });
}

export async function GET(req: NextRequest) {
  if (!isAnalyticsAdminConfigured()) {
    return gate("<p>Internal research access is not configured. Contact the site administrator.</p>", 503);
  }

  if (!hasValidAnalyticsAdminSession(req.cookies.get(ANALYTICS_ADMIN_COOKIE)?.value)) {
    const error = req.nextUrl.searchParams.get("error") === "1"
      ? '<p class="error" role="alert">That password did not match. Try again.</p>'
      : "";
    return gate(`<p>Sign in with the existing Explorer dashboard password to open the corridor research map.</p><form method="post" action="/api/admin/analytics/login"><input type="hidden" name="redirectTo" value="/research/ctc-small-business"><label for="password">Dashboard password</label><input id="password" name="password" type="password" autocomplete="current-password" required>${error}<button type="submit">Open research map</button></form>`, 401);
  }

  // Keep the internal artifact outside public/ and read it only after authentication.
  // next.config.ts explicitly includes this file in the deployed function.
  try {
    const html = await readFile(path.join(process.cwd(), "data/private/ctc-research/corridor-map.html"), "utf8");
    return new NextResponse(html, { headers });
  } catch {
    return gate("<p>The research map is temporarily unavailable. Please try again later.</p>", 503);
  }
}
