/**
 * scripts/export-investment-brief.ts
 *
 * Print the admin-gated Community Investment Brief (/print/investment/[area]) to
 * a letter-size PDF with the installed puppeteer. This is the PDF-snapshot half
 * of the comps-memo precedent: report-as-web-page (app/print/investment/[area])
 * + @page print CSS (in that page) + this headless snapshot.
 *
 * Run (against a server this script boots for you):
 *   npx tsx scripts/export-investment-brief.ts --area "South Shore" --out ~/Desktop/brief.pdf
 *
 * Or target an already-running server (e.g. `npm run dev` / a preview):
 *   npx tsx scripts/export-investment-brief.ts --area "South Shore" --base-url http://localhost:3000 --out ~/Desktop/brief.pdf
 *
 * Flags:
 *   --area <name>       Community area (required), e.g. "South Shore".
 *   --out <path>        Output PDF path (default: ~/Desktop/<area>-investment-brief.pdf). `~` is expanded.
 *   --base-url <url>    Target a RUNNING server instead of booting one. When omitted,
 *                       the script builds (if needed) and boots `next start` on a free port.
 *
 * Auth: the brief is behind the Owner Files admin gate. This script authenticates
 * by POSTing OWNER_FILES_ADMIN_PASSWORD (from env) to the existing login route
 * (/api/admin/investment/login) and carrying the returned session cookie into
 * puppeteer — it NEVER hardcodes a password. With OWNER_FILES_ADMIN_PASSWORD
 * unset it prints a clear message and exits 0 (skipped, not failed).
 *
 * NOT package.json-registered by design (no package.json/lockfile edits in this
 * change) — invoke it with the `npx tsx …` line above.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import puppeteer from "puppeteer";

const OWNER_FILES_ADMIN_COOKIE = "cie_owner_files_admin";
const LOGIN_PATH = "/api/admin/investment/login";

interface Args {
  area: string;
  out: string;
  baseUrl: string | null;
}

function parseArgs(argv: string[]): Args {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        map.set(key, next);
        i++;
      } else {
        map.set(key, "true");
      }
    }
  }
  const area = map.get("area");
  if (!area) {
    throw new Error('Missing --area. Example: --area "South Shore"');
  }
  const expand = (p: string) => (p.startsWith("~") ? path.join(homedir(), p.slice(1)) : p);
  const out = expand(map.get("out") ?? path.join(homedir(), "Desktop", `${area.replace(/\s+/g, "-")}-investment-brief.pdf`));
  const baseUrl = map.get("base-url") ?? null;
  return { area, out, baseUrl: baseUrl ? baseUrl.replace(/\/+$/, "") : null };
}

/** Ask the OS for an open port by binding to 0, then releasing it. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("Could not determine a free port")));
      }
    });
  });
}

async function wait(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Poll the base URL until the server answers (any HTTP status) or we time out. */
async function waitForServer(base: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base, { redirect: "manual" });
      if (res.status > 0) return;
    } catch {
      // not up yet
    }
    await wait(500);
  }
  throw new Error(`Server at ${base} did not become ready within ${timeoutMs}ms`);
}

/** Boot `next start` on a free port (building first if there's no build). Returns
 * the base URL and the child process so the caller can shut it down. */
async function bootServer(): Promise<{ base: string; child: ChildProcess }> {
  const cwd = process.cwd();
  if (!existsSync(path.join(cwd, ".next", "BUILD_ID"))) {
    console.log("[export-brief] No production build found — running `next build` first…");
    await new Promise<void>((resolve, reject) => {
      const build = spawn("npx", ["next", "build"], { cwd, stdio: "inherit", env: process.env });
      build.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`next build exited ${code}`))));
      build.on("error", reject);
    });
  }
  const port = await getFreePort();
  const base = `http://localhost:${port}`;
  console.log(`[export-brief] Booting next start on ${base} …`);
  const child = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  child.on("error", (err) => {
    console.error("[export-brief] next start failed to spawn:", err);
  });
  await waitForServer(base);
  return { base, child };
}

/** Authenticate against the gate and return the session cookie `name=value`. */
async function authenticate(base: string, password: string): Promise<string> {
  const body = new URLSearchParams({ password, redirectTo: "/investment" });
  const res = await fetch(`${base}${LOGIN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual",
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const location = res.headers.get("location") ?? "";
  if (location.includes("error=1")) {
    throw new Error("Authentication failed: the password did not match OWNER_FILES_ADMIN_PASSWORD on the server.");
  }
  const sessionCookie = setCookies.find((c) => c.startsWith(`${OWNER_FILES_ADMIN_COOKIE}=`));
  if (!sessionCookie) {
    throw new Error(
      "No session cookie returned by the login route. Is OWNER_FILES_ADMIN_PASSWORD (and AUTH_SECRET) set on the server?",
    );
  }
  // Keep only the `name=value` pair (drop Path/HttpOnly/… attributes).
  return sessionCookie.split(";")[0];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const password = process.env.OWNER_FILES_ADMIN_PASSWORD;
  if (!password) {
    console.log(
      "[export-brief] SKIPPED: OWNER_FILES_ADMIN_PASSWORD is not set. The Community Investment Brief is admin-gated;\n" +
        "               set OWNER_FILES_ADMIN_PASSWORD (the same password the /investment gate uses) and re-run.",
    );
    return;
  }

  let child: ChildProcess | null = null;
  const browser = await puppeteer.launch({ headless: true });
  try {
    let base = args.baseUrl;
    if (!base) {
      const booted = await bootServer();
      base = booted.base;
      child = booted.child;
    } else {
      console.log(`[export-brief] Targeting running server at ${base}`);
      await waitForServer(base, 15_000);
    }

    const cookiePair = await authenticate(base, password);
    console.log("[export-brief] Authenticated.");

    const page = await browser.newPage();
    // Carry the session as a request header — version-proof across puppeteer's
    // setCookie API churn, and applied to the navigation request.
    await page.setExtraHTTPHeaders({ Cookie: cookiePair });

    const url = `${base}/print/investment/${encodeURIComponent(args.area)}`;
    console.log(`[export-brief] Rendering ${url} …`);
    await page.goto(url, { waitUntil: "networkidle0", timeout: 120_000 });

    // Guard: if the gate bounced us to the login form, the brief did not render.
    const gated = await page.$(".brief-sheet");
    if (!gated) {
      const loginVisible = await page.$('form[action="/api/admin/investment/login"]');
      throw new Error(
        loginVisible
          ? "Rendered the login form instead of the brief — authentication cookie was not accepted."
          : `Could not find the brief for "${args.area}". Check the community-area name and that the dataset is present.`,
      );
    }

    mkdirSync(path.dirname(args.out), { recursive: true });
    await page.pdf({
      path: args.out,
      format: "letter",
      printBackground: true,
      preferCSSPageSize: true,
    });
    console.log(`[export-brief] Wrote ${args.out}`);
  } finally {
    await browser.close();
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
  }
}

main().catch((err) => {
  console.error("[export-brief] ERROR:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
