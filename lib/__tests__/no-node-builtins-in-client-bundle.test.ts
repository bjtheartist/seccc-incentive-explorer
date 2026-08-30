/**
 * Hardening round, Track B item 3 — "GUARD EXTENSION: node: schemes."
 *
 * lib/__tests__/no-internal-catalog-in-client-bundle.test.ts already proves
 * no "use client" file can statically reach node:fs (or bare "fs") — but
 * that check is hard-coded to exactly those two specifiers. This guard
 * generalizes the SAME import-graph walk (shared via
 * lib/source-guard/client-bundle-import-graph.ts) to ANY node:* built-in —
 * node:crypto and node:path included, the two the exhibit round actually
 * hit — plus the handful of legacy bare names (no `node:` prefix) this
 * codebase's history shows are just as dangerous. A "node:" prefix on an
 * import specifier is reserved by Node.js itself for core modules, so
 * flagging every specifier that starts with it can never false-positive on
 * an ordinary npm package.
 *
 * The two REAL historical breaks this must catch if re-injected (both
 * fixed already — see the git history on lib/permit-exhibit.ts and
 * lib/shortlist-access.ts, and each component's own doc comment):
 *
 *   1. components/permit-exhibit/PermitExhibitEntryForm.tsx statically
 *      importing anything from lib/permit-exhibit.ts, which imports
 *      `readFile` from "node:fs/promises" at module scope. Fixed by
 *      passing radiusOptions/defaultRadiusFt down as plain props from the
 *      server-component page instead.
 *   2. components/permit-exhibit/PermitExhibitAccessGate.tsx statically
 *      importing PERMIT_EXHIBIT_ACCESS_SOURCE from lib/shortlist-access.ts,
 *      which imports `createHmac`/`timingSafeEqual` from "node:crypto" at
 *      module scope. Fixed by carrying a local literal copy instead — see
 *      lib/__tests__/permit-exhibit-access-gate-source.test.ts, which this
 *      guard does NOT replace: that test protects against the literal
 *      drifting from lib/shortlist-access.ts's real value (a value-sync
 *      concern); this guard protects against the import itself coming
 *      back (a bundle-breakage concern). Kept, not folded — different
 *      failure mode.
 *
 * Both are reproduced below as synthetic fixtures (in-memory ts-morph
 * projects, not edits to the real files) to prove the walker actually
 * catches them, before the real-codebase scan trusts a clean result.
 */
import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import {
  buildRealProject,
  findPathToMatchingSpecifier,
  findRealClientRoots,
} from "@/lib/source-guard/client-bundle-import-graph";

// GitHub's shared runner is materially slower than a developer machine for
// ts-morph's repeated whole-project graph walks (same rationale as the
// sibling guard's REAL_CODEBASE_SCAN_TIMEOUT_MS).
const REAL_CODEBASE_SCAN_TIMEOUT_MS = 180_000;

/** A small curated set of legacy bare (no `node:` prefix) specifiers this
 *  codebase has already hit in the wild, checked alongside the general
 *  `node:` prefix rule below. Not exhaustive by design — the prefix rule
 *  is what makes this a generalized guard; this list is defense in depth
 *  for the pre-`node:`-prefix import style some code still uses. */
const LEGACY_BARE_NODE_BUILTINS = new Set(["fs", "fs/promises", "crypto", "path"]);

function isNodeBuiltinSpecifier(specifier: string): boolean {
  return specifier.startsWith("node:") || LEGACY_BARE_NODE_BUILTINS.has(specifier);
}

describe("client-transitive node:* builtin guard — synthetic self-test (proves the walker works)", () => {
  it("catches a DIRECT node:crypto import in a 'use client' file", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const clientFile = project.createSourceFile(
      "/components/Bad.tsx",
      `"use client";\nimport { createHmac } from "node:crypto";\nexport default function C() { return createHmac("sha256", "k"); }`,
    );
    const chain = findPathToMatchingSpecifier(clientFile, isNodeBuiltinSpecifier);
    expect(chain).not.toBeNull();
  });

  it("catches a TRANSITIVE node:crypto import — the exact shape of PermitExhibitAccessGate.tsx -> lib/shortlist-access.ts", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/lib/shortlist-access.ts",
      `import { createHmac } from "node:crypto";\nexport const PERMIT_EXHIBIT_ACCESS_SOURCE = "permit-exhibit-gate-2026";\nexport function sign(v: string) { return createHmac("sha256", "k").update(v).digest("hex"); }`,
    );
    const clientFile = project.createSourceFile(
      "/components/permit-exhibit/PermitExhibitAccessGate.tsx",
      `"use client";\nimport { PERMIT_EXHIBIT_ACCESS_SOURCE } from "../../lib/shortlist-access";\nexport default function Gate() { return PERMIT_EXHIBIT_ACCESS_SOURCE; }`,
    );
    const chain = findPathToMatchingSpecifier(clientFile, isNodeBuiltinSpecifier);
    expect(chain).not.toBeNull();
    expect(chain).toContain("/lib/shortlist-access.ts");
  });

  it("catches a TRANSITIVE node:fs/promises import — the exact shape of PermitExhibitEntryForm.tsx -> lib/permit-exhibit.ts", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/lib/permit-exhibit.ts",
      `import { readFile } from "node:fs/promises";\nexport const PERMIT_EXHIBIT_ALLOWED_RADIUS_FT = [250, 500, 1000] as const;\nexport async function loadArchive() { return readFile("x"); }`,
    );
    const clientFile = project.createSourceFile(
      "/components/permit-exhibit/PermitExhibitEntryForm.tsx",
      `"use client";\nimport { PERMIT_EXHIBIT_ALLOWED_RADIUS_FT } from "../../lib/permit-exhibit";\nexport default function Form() { return PERMIT_EXHIBIT_ALLOWED_RADIUS_FT.length; }`,
    );
    const chain = findPathToMatchingSpecifier(clientFile, isNodeBuiltinSpecifier);
    expect(chain).not.toBeNull();
    expect(chain).toContain("/lib/permit-exhibit.ts");
  });

  it("catches node:path as a third example of the generalized `node:` prefix rule (not hard-coded to fs/crypto)", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/lib/paths.ts",
      `import { join } from "node:path";\nexport function full(a: string) { return join("/base", a); }`,
    );
    const clientFile = project.createSourceFile(
      "/components/Bad2.tsx",
      `"use client";\nimport { full } from "../lib/paths";\nexport default full;`,
    );
    const chain = findPathToMatchingSpecifier(clientFile, isNodeBuiltinSpecifier);
    expect(chain).not.toBeNull();
  });

  it("catches an UNLISTED node: builtin (e.g. node:os) purely from the `node:` prefix — proves this is a generalized rule, not a hard-coded list", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const clientFile = project.createSourceFile(
      "/components/Bad3.tsx",
      `"use client";\nimport { tmpdir } from "node:os";\nexport default tmpdir;`,
    );
    const chain = findPathToMatchingSpecifier(clientFile, isNodeBuiltinSpecifier);
    expect(chain).not.toBeNull();
  });

  it("does NOT flag a client file with no node:* builtin in its reachable graph", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("/lib/pure.ts", `export function y() { return 2; }`);
    const clientFile = project.createSourceFile(
      "/components/Good.tsx",
      `"use client";\nimport { y } from "../lib/pure";\nexport default y;`,
    );
    expect(findPathToMatchingSpecifier(clientFile, isNodeBuiltinSpecifier)).toBeNull();
  });

  it("does NOT flag an `import type` of a node:*-touching module's exported type — TS erases it before it reaches a bundle", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/lib/server-only.ts",
      `import { createHmac } from "node:crypto";\nexport interface Ctx { id: string }\nexport function sign() { return createHmac("sha256", "k"); }`,
    );
    const clientFile = project.createSourceFile(
      "/components/Good2.tsx",
      `"use client";\nimport type { Ctx } from "../lib/server-only";\nexport function C(props: Ctx) { return props.id; }`,
    );
    expect(findPathToMatchingSpecifier(clientFile, isNodeBuiltinSpecifier)).toBeNull();
  });

  it("does NOT flag a bare npm package whose name happens to contain 'node' or 'path' as a substring (the `node:` check is a prefix match, not a substring match)", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const clientFile = project.createSourceFile(
      "/components/Good3.tsx",
      `"use client";\nimport { thing } from "some-node-thing";\nimport other from "react-path-utils";\nexport default function C() { return [thing, other]; }`,
    );
    expect(findPathToMatchingSpecifier(clientFile, isNodeBuiltinSpecifier)).toBeNull();
  });
});

describe("client-transitive node:* builtin guard — real codebase scan", () => {
  const project = buildRealProject();
  const clientRoots = findRealClientRoots(project);

  it("finds a non-trivial number of 'use client' roots (the scan is not silently a no-op)", () => {
    expect(clientRoots.length).toBeGreaterThan(20);
  });

  it(
    "no node:* built-in (or legacy bare fs/fs-promises/crypto/path) import is reachable from any 'use client' file, directly or transitively",
    () => {
      const offenders: { root: string; chain: string[] }[] = [];
      for (const root of clientRoots) {
        const chain = findPathToMatchingSpecifier(root, isNodeBuiltinSpecifier);
        if (chain) offenders.push({ root: root.getFilePath(), chain });
      }
      if (offenders.length > 0) {
        const report = offenders
          .map((o) => `  ${o.root}\n    -> ${o.chain.join("\n    -> ")}`)
          .join("\n");
        throw new Error(
          `${offenders.length} client component(s) can reach a node:* built-in through the static import graph:\n${report}\n` +
            `Fix: move the node-builtin-touching logic into a server-only Route Handler or Server Component and pass ` +
            `the result down as plain data/props (see components/permit-exhibit/PermitExhibitEntryForm.tsx), or carry a ` +
            `local literal copy of the one value actually needed (see PermitExhibitAccessGate.tsx + ` +
            `lib/__tests__/permit-exhibit-access-gate-source.test.ts) rather than importing the module at all.`,
        );
      }
      expect(offenders.length).toBe(0);
    },
    REAL_CODEBASE_SCAN_TIMEOUT_MS,
  );
});
