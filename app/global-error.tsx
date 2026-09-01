"use client";

/**
 * Root error boundary (R1 finding 2) — the last line of defence.
 *
 * This catches what app/error.tsx cannot: an error thrown by the root layout
 * itself. Next replaces the ENTIRE document when it renders, so this file must
 * supply its own <html> and <body>, and — because the root layout (and with it
 * globals.css and the @fontsource imports) is exactly what failed — it cannot
 * rely on the app's stylesheet or fonts being present. Every style here is
 * therefore inline, and the type stack falls back to system fonts.
 *
 * Same doctrine as app/error.tsx: say what happened, never blame the reader,
 * always leave a working way forward. Deliberately minimal — this screen must
 * be able to render when nothing else can.
 */

import { useEffect } from "react";

const INK = "#0C1B33";
const PAPER = "#FAF9F6";
const ACCENT = "#2563EB";
const SANS =
  'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error boundary] unhandled root error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: PAPER, color: INK, fontFamily: SANS }}>
        <div style={{ maxWidth: "36rem", margin: "0 auto", padding: "4rem 1.25rem" }}>
          <p
            style={{
              margin: 0,
              fontFamily: MONO,
              fontSize: "10px",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "rgba(12,27,51,0.45)",
            }}
          >
            Something broke on our side
          </p>
          <h1
            style={{
              margin: "0.75rem 0 0",
              fontSize: "2.375rem",
              lineHeight: 0.98,
              fontWeight: 400,
              fontFamily: 'Playfair Display, Georgia, "Times New Roman", serif',
            }}
          >
            The Explorer didn&rsquo;t load
          </h1>
          <p
            style={{
              margin: "1rem 0 0",
              fontSize: "14px",
              lineHeight: 1.7,
              color: "rgba(12,27,51,0.6)",
            }}
          >
            An error stopped the app before it could render. Nothing you did caused it, and nothing
            you entered was lost. Trying again often works.
          </p>
          {error.digest ? (
            <p
              style={{
                margin: "0.75rem 0 0",
                fontFamily: MONO,
                fontSize: "11px",
                color: "rgba(12,27,51,0.35)",
              }}
            >
              Reference {error.digest}
            </p>
          ) : null}
          <div style={{ marginTop: "1.75rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                minHeight: "2.75rem",
                padding: "0.75rem 1rem",
                border: "none",
                background: ACCENT,
                color: "#fff",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            {/* A plain anchor, deliberately. `next/link` needs the client
                router, and this boundary renders precisely when the root
                layout — and therefore the app shell around that router —
                failed. A full document navigation is the only exit that is
                guaranteed to work here. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                minHeight: "2.75rem",
                display: "inline-flex",
                alignItems: "center",
                padding: "0.75rem 1rem",
                border: "1px solid rgba(12,27,51,0.2)",
                background: "#fff",
                color: "rgba(12,27,51,0.7)",
                fontSize: "12px",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Back to the start
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
