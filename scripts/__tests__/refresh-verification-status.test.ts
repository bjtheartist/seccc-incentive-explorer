import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const commands = [
  "run data:manifest:verify", "run lint", "test", "tsc --noEmit", "run build -- --webpack",
];

describe("monthly refresh verification exit status (#417)", () => {
  // Execute the workflow's actual shell entrypoint, with only npm/npx stubbed.
  // This catches the old pipeline-subshell bug; a source-text assertion cannot.
  const workflow = readFileSync(".github/workflows/data-refresh.yml", "utf8");
  const verifyStep = workflow.split("id: verify")[1].split("- name:")[0];
  const invocation = verifyStep.match(/run: (bash [^\n]+)/)?.[1];

  it.each([null, ...commands])("retains all gate results when failing command is %s", (failedCommand) => {
    const temp = mkdtempSync(join(tmpdir(), "refresh-verify-"));
    try {
      expect(invocation).toBeDefined();
      const calls = join(temp, "calls");
      const output = join(temp, "output");
      const stub = '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$CALLS"\n' +
        'if [ "$*" = "$FAIL_COMMAND" ]; then echo "fixture gate failure: $*" >&2; exit 1; fi\n';
      for (const name of ["npm", "npx"]) writeFileSync(join(temp, name), stub, { mode: 0o755 });
      const result = spawnSync("bash", ["-c", invocation!], {
        encoding: "utf8",
        env: {
          ...process.env, PATH: `${temp}:${process.env.PATH}`, RUNNER_TEMP: temp,
          GITHUB_OUTPUT: output, CALLS: calls, FAIL_COMMAND: failedCommand ?? "none",
        },
      });
      expect(result.status, result.stderr).toBe(failedCommand === null ? 0 : 1);
      expect(readFileSync(output, "utf8")).toBe(`verify_failed=${failedCommand !== null}\n`);
      expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual(commands);
      const log = readFileSync(join(temp, "verify.log"), "utf8");
      for (const stage of ["manifest", "lint", "test", "typecheck", "build"]) {
        expect(log).toContain(`### ${stage}`);
      }
      if (failedCommand) expect(log).toContain(`fixture gate failure: ${failedCommand}`);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
