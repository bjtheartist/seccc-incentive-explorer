"use client";

import { FormEvent, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";

interface Fields {
  name: string;
  title: string;
  email: string;
  website: string;
}

const EMPTY_FIELDS: Fields = { name: "", title: "", email: "", website: "" };

export default function ShortlistAccessGate({
  candidateCount,
  neighborhood,
}: {
  candidateCount: number;
  neighborhood: string;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [status, setStatus] = useState<"idle" | "submitting">("idle");
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setError(null);
    try {
      const response = await fetch("/api/shortlist-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "We could not open the shortlist. Please try again.",
        );
      }
      router.refresh();
    } catch (submissionError) {
      setStatus("idle");
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "We could not open the shortlist. Please try again.",
      );
    }
  }

  return (
    <section
      className="relative mt-8 overflow-hidden border border-[#0C1B33]/12 bg-white"
      aria-labelledby="shortlist-access-title"
      data-testid="shortlist-access-gate"
    >
      <div className="border-b border-[#0C1B33]/8 bg-[#F3F4F6] px-6 py-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#0C1B33]/45">
            <LockKeyhole className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <span className="font-mono-bureau text-[9px] uppercase tracking-[0.18em] text-[#0C1B33]/38">
              Your shortlist is ready
            </span>
            <p className="mt-1 text-[12px] text-[#0C1B33]/52">
              {candidateCount} ranked {candidateCount === 1 ? "record" : "records"} in {neighborhood}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-8 p-6 lg:grid-cols-[0.8fr_1.2fr] lg:p-8">
        <div>
          <h2 id="shortlist-access-title" className="font-editorial text-[34px] leading-tight">
            Sign up to view the final list.
          </h2>
          <p className="mt-4 max-w-md text-[13px] leading-6 text-[#0C1B33]/55">
            Create free access to see the ranked property cards, map, parcel details, incentive snapshots, and CSV download.
          </p>
          <p className="mt-5 border-l-2 border-[#2563EB]/35 pl-3 text-[11px] leading-5 text-[#0C1B33]/42">
            The shortlist is built from public records and is not an availability listing. You will still need to verify ownership, zoning, condition, and status.
          </p>
        </div>

        <form onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#0C1B33]/48">Name</span>
              <input
                name="name"
                required
                autoComplete="name"
                maxLength={120}
                value={fields.name}
                onChange={(event) => update("name", event.target.value)}
                className="mt-2 h-11 w-full border border-[#0C1B33]/15 px-3 text-[14px] outline-none focus:border-[#2563EB]"
              />
            </label>
            <label className="block">
              <span className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#0C1B33]/48">Title</span>
              <input
                name="title"
                required
                autoComplete="organization-title"
                maxLength={160}
                value={fields.title}
                onChange={(event) => update("title", event.target.value)}
                className="mt-2 h-11 w-full border border-[#0C1B33]/15 px-3 text-[14px] outline-none focus:border-[#2563EB]"
              />
            </label>
            <label className="block">
              <span className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#0C1B33]/48">Email</span>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                maxLength={254}
                value={fields.email}
                onChange={(event) => update("email", event.target.value)}
                className="mt-2 h-11 w-full border border-[#0C1B33]/15 px-3 text-[14px] outline-none focus:border-[#2563EB]"
              />
            </label>
          </div>

          <div className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
            <label htmlFor="shortlist-website">Website</label>
            <input
              id="shortlist-website"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={fields.website}
              onChange={(event) => update("website", event.target.value)}
            />
          </div>

          {error ? (
            <p className="mt-4 border-l-2 border-red-600 pl-3 text-[12px] text-red-700" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={status === "submitting"}
            className="mt-5 inline-flex min-h-11 w-full items-center justify-center bg-[#0C1B33] px-5 py-3 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-white transition-colors hover:bg-[#2563EB] disabled:cursor-wait disabled:opacity-60"
          >
            {status === "submitting" ? "Unlocking..." : "Sign up and view shortlist"}
          </button>
          <p className="mt-3 text-[10px] leading-4 text-[#0C1B33]/35">
            We&apos;ll use these details to provide product access and understand who the Site Matchmaker is serving.
          </p>
        </form>
      </div>
    </section>
  );
}
