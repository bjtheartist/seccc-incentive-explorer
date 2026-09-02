import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * R2 finding 7 follow-up — the env doctrine has to actually RUN.
 *
 * lib/env.ts self-executes `assertEnvOnce()` at module scope and was written
 * so a malformed value (`DOCUMENTS_ENABLED=1`, which the call sites compare
 * `=== "true"` and therefore read as OFF) is reported instead of silently
 * selecting the wrong branch. It shipped with no importer anywhere in `app/`,
 * `lib/`, `components/` or `next.config.ts` — only its own unit test — so in
 * production the check never ran at all and the finding was documented rather
 * than fixed.
 *
 * These tests pin the two entry points that make it run:
 *  - instrumentation.ts's register(), which Next calls once per server
 *    instance (nodejs runtime only), and
 *  - next.config.ts, whose module-scope import gives `next build` its own
 *    pass in the build process.
 *
 * They are deliberately behavioral where they can be: register() is CALLED
 * and the doctrine's own output is asserted, rather than grepping for an
 * import statement.
 */

const REPO_ROOT = path.join(__dirname, "..", "..");

async function callRegisterWithFreshEnvModule(runtime: string): Promise<void> {
  vi.stubEnv("NEXT_RUNTIME", runtime);
  vi.resetModules();
  const { register } = await import("../../instrumentation");
  await register();
}

beforeEach(() => {
  // Not "development": lib/env.ts THROWS there by design (fastest local
  // feedback). Vitest already runs as "test", where the doctrine logs.
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("instrumentation.ts register() runs the env doctrine", () => {
  it("reports a malformed value in the nodejs runtime — the whole point of the module", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // The exact trap lib/env.ts documents: "1" is not "true", so every
    // `=== "true"` call site reads this flag as OFF.
    vi.stubEnv("DOCUMENTS_ENABLED", "1");

    await callRegisterWithFreshEnvModule("nodejs");

    expect(error).toHaveBeenCalledTimes(1);
    const report = String(error.mock.calls[0]?.[0]);
    expect(report).toContain("[env]");
    expect(report).toContain("DOCUMENTS_ENABLED");
  });

  it("stays silent when every set value is well-formed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("DOCUMENTS_ENABLED", "true");

    await callRegisterWithFreshEnvModule("nodejs");

    expect(error).not.toHaveBeenCalled();
  });

  it("does not break a build whose variables are legitimately absent", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // CI runs `next build` with no DATABASE_URL, no Redis, no Resend key.
    // Absence is a supported configuration in this app, never an error.
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("DOCUMENTS_ENABLED", "");

    await expect(callRegisterWithFreshEnvModule("nodejs")).resolves.toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });

  it("is a no-op in the edge runtime — no full process.env there to validate", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("DOCUMENTS_ENABLED", "1");

    await callRegisterWithFreshEnvModule("edge");

    expect(error).not.toHaveBeenCalled();
  });
});

describe("the entry points import lib/env.ts", () => {
  it("instrumentation.ts is the runtime importer and guards the runtime split", () => {
    const source = readFileSync(path.join(REPO_ROOT, "instrumentation.ts"), "utf8");
    expect(source).toContain("./lib/env");
    expect(source).toContain('process.env.NEXT_RUNTIME !== "nodejs"');
    expect(source).toMatch(/export async function register\s*\(/);
  });

  it("next.config.ts imports it too, so `next build` gets its own pass", () => {
    const source = readFileSync(path.join(REPO_ROOT, "next.config.ts"), "utf8");
    expect(source).toMatch(/import\s+["']\.\/lib\/env["']/);
  });

  it("lib/env.ts has at least one non-test importer — the defect this closes", async () => {
    // The original finding was literally "the only importer is its own test".
    // Assert on the real tree rather than a hardcoded list, so deleting the
    // wiring fails here no matter which entry point it was deleted from.
    const { execFileSync } = await import("node:child_process");
    const matches = execFileSync(
      "grep",
      [
        "-rlE",
        String.raw`from ["'](\.\.?\/)*(lib\/)?env["']|import ["'](\.\/)?lib\/env["']|import\(["']\.\/lib\/env["']\)`,
        "app",
        "lib",
        "components",
        "instrumentation.ts",
        "next.config.ts",
      ],
      { cwd: REPO_ROOT, encoding: "utf8" },
    )
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.includes("__tests__"));

    expect(matches).toContain("instrumentation.ts");
    expect(matches).toContain("next.config.ts");
  });
});
