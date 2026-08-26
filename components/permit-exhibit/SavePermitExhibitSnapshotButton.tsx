"use client";

import { FormEvent, useState } from "react";
import { Save } from "lucide-react";
import { useRouter } from "next/navigation";

export function SavePermitExhibitSnapshotButton({
  pin,
  radiusFt,
  requestId,
}: {
  pin: string;
  radiusFt: number;
  requestId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/permit-exhibit-snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, radiusFt, requestId }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: unknown;
        url?: unknown;
      };
      if (!response.ok || typeof payload.url !== "string") {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "The snapshot could not be saved right now. Please try again.",
        );
      }
      router.push(payload.url);
    } catch (submissionError) {
      setPending(false);
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "The snapshot could not be saved right now. Please try again.",
      );
    }
  }

  return (
    <form onSubmit={submit} className="contents">
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="inline-flex min-h-9 items-center border border-[#0C1B33] bg-[#0C1B33] px-3 py-1.5 font-mono-bureau text-[10px] font-medium uppercase tracking-[0.08em] text-white transition-colors hover:border-[#2563EB] hover:bg-[#2563EB] disabled:cursor-wait disabled:opacity-60"
      >
        <Save aria-hidden className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.8} />
        {pending ? "Saving snapshot…" : "Save read-only snapshot"}
      </button>
      {error ? (
        <p className="basis-full border-l-2 border-red-600 pl-3 text-[11px] text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
