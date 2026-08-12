import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // The "server-only" marker package throws unconditionally from its
      // default export and only resolves to a no-op via the "react-server"
      // package-export condition, which Next's webpack/turbopack build sets
      // but plain Vitest does not. Point it straight at that no-op so
      // server-only lib modules (e.g. lib/shortlist-universe.ts) stay
      // unit-testable without flipping a global resolve condition that
      // could silently change how React/Next packages resolve elsewhere.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    exclude: ["tests/e2e/**", "**/node_modules/**", "**/.next/**"],
  },
});
