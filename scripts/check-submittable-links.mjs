#!/usr/bin/env node
// Nightly health check for Submittable application portals.
// Reads public/data/programs.json, pings every applicationPortals[].url where
// type === "submittable", writes results to public/data/link-health.json.
//
// The UI consumes link-health.json to gate the "Apply via Submittable" button:
// only render when status === "ok" and verifiedAt is recent.

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PROGRAMS_PATH = resolve(ROOT, "public/data/programs.json");
const HEALTH_PATH = resolve(ROOT, "public/data/link-health.json");

const TIMEOUT_MS = 15000;

async function ping(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "chicagoincentiveexplorer-link-check/1.0 (+https://chicagoincentiveexplorer.com)",
      },
    });
    return { ok: res.ok, status: res.status, finalUrl: res.url };
  } catch (err) {
    return { ok: false, status: 0, error: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const programs = JSON.parse(await readFile(PROGRAMS_PATH, "utf-8"));
  const checkedAt = new Date().toISOString();

  const portals = [];
  for (const program of programs) {
    const list = program.applicationPortals || [];
    for (const portal of list) {
      if (portal.type !== "submittable") continue;
      portals.push({ programId: program.id, portal });
    }
  }

  console.log(`Checking ${portals.length} Submittable portals…`);

  const results = await Promise.all(
    portals.map(async ({ programId, portal }) => {
      const r = await ping(portal.url);
      const status = r.ok ? "ok" : "broken";
      console.log(
        `[${status.padEnd(6)}] ${programId} ${portal.language || "en"}  ${
          r.status
        }  ${portal.url}`,
      );
      return {
        programId,
        url: portal.url,
        language: portal.language || "en",
        status,
        httpStatus: r.status,
        finalUrl: r.finalUrl ?? null,
        error: r.error ?? null,
        checkedAt,
      };
    }),
  );

  const okCount = results.filter((r) => r.status === "ok").length;
  const out = {
    checkedAt,
    totals: { checked: results.length, ok: okCount, broken: results.length - okCount },
    portals: results,
  };

  await writeFile(HEALTH_PATH, JSON.stringify(out, null, 2) + "\n", "utf-8");
  console.log(`Wrote ${HEALTH_PATH} — ${okCount}/${results.length} ok`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
