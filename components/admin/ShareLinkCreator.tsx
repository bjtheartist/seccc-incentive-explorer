"use client";

import { useState } from "react";

const FIELD =
  "w-full border border-[#0C1B33]/15 bg-white px-3 py-2.5 text-[13px] text-[#0C1B33] outline-none focus:border-[#2563EB]";

export function ShareLinkCreator({
  expiryOptionsDays,
  defaultExpiryDays,
}: {
  expiryOptionsDays: readonly number[];
  defaultExpiryDays: number;
}) {
  const [label, setLabel] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(defaultExpiryDays);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ label: string; url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setCopied(false);
    try {
      const response = await fetch("/api/admin/public-investment-share-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, expiresInDays }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        url?: string;
        label?: string;
        expiresAt?: string;
      };
      if (!response.ok || !payload.url) {
        setError(payload.error || "Could not create the share link.");
        return;
      }
      setCreated({ label: payload.label || label, url: payload.url, expiresAt: payload.expiresAt || "" });
      setLabel("");
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="border border-[#0C1B33]/10 bg-white p-5 sm:p-6">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="block">
          <span className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#0C1B33]/40">
            Who is this link for
          </span>
          <input
            name="label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            required
            minLength={2}
            maxLength={160}
            placeholder="e.g. Chicago Community Trust — Chandra"
            className={`mt-1.5 ${FIELD}`}
          />
        </label>
        <label className="block">
          <span className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#0C1B33]/40">
            Expires in
          </span>
          <select
            name="expiresInDays"
            value={expiresInDays}
            onChange={(event) => setExpiresInDays(Number(event.target.value))}
            className={`mt-1.5 ${FIELD}`}
          >
            {expiryOptionsDays.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="bg-[#0C1B33] px-4 py-3 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-white disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create share link"}
        </button>
      </form>
      {error ? <p className="mt-3 text-[12px] text-red-600">{error}</p> : null}
      {created ? (
        <div
          data-testid="share-link-created"
          className="mt-4 border-l-2 border-[#16A34A] bg-[#F0FDF4] px-4 py-3 text-[13px] text-[#166534]"
        >
          <p>
            Link for <strong>{created.label}</strong> is ready. Copy it now: it is shown only once, and it opens
            the investment analysis for anyone who has it.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={created.url}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 border border-[#16A34A]/30 bg-white px-3 py-2 font-mono-bureau text-[11px] text-[#0C1B33]"
            />
            <button
              type="button"
              onClick={copy}
              className="border border-[#16A34A] bg-white px-3 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#166534]"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
