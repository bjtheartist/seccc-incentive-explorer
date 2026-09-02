/**
 * instrumentation.ts — the app's one boot-time entry point.
 *
 * R2 finding 7 shipped `lib/env.ts`, which self-executes its validation pass
 * on first import. Nothing imported it. `app/`, `lib/`, `components/` and
 * `next.config.ts` all had zero references, so the entire env doctrine was
 * dead code: `DOCUMENTS_ENABLED=1` in production still read as OFF at its
 * `=== "true"` call site, and nothing was logged — exactly the defect the
 * module was written to catch. This file is the importer.
 *
 * Next calls `register()` once per server instance (Next 16 — the hook is
 * stable, no `experimental.instrumentationHook` flag needed). `next build`
 * gets its own pass via next.config.ts, which value-imports lib/env.ts in the
 * build's Node process; see the note there.
 *
 * Runtime guard: `NEXT_RUNTIME` is `"nodejs"` or `"edge"`, and this hook is
 * loaded for BOTH. The edge bundle has neither the full `process.env` nor any
 * business validating server-only variables, so it returns early — matching
 * lib/env.ts's own `typeof window === "undefined"` server-only guard. There
 * is no browser case: instrumentation never runs in the browser.
 *
 * Failure policy is entirely lib/env.ts's (see its "Failure policy, by
 * environment" block): development throws, production logs and continues,
 * test logs only. Nothing here adds a failure mode of its own — in
 * particular, an environment with variables legitimately ABSENT (CI running
 * `next build` with no DATABASE_URL, no Redis, no Resend key) produces zero
 * issues, because every field in the schema is optional by design.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Side-effect import: lib/env.ts runs assertEnvOnce() at module scope.
  await import("./lib/env");
}
