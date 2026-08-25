"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2 } from "lucide-react";

export function PublicInvestmentVerificationNotice() {
  const params = useSearchParams();
  const result = params.get("verification");
  const signInResult = params.get("signin");
  if (!result && !signInResult) return null;

  const verified = result === "verified";
  return (
    <div
      className={`mb-8 border-l-2 px-4 py-3 text-[13px] leading-6 ${
        verified
          ? "border-[#16A34A] bg-[#F0FDF4] text-[#166534]"
          : "border-[#B45309] bg-[#FFFBEB] text-[#92400E]"
      }`}
      role="status"
    >
      {signInResult === "invalid"
        ? "That sign-in link is incomplete. Request another one below."
        : verified
        ? "Email verified. Your request is ready for review, and we’ll email you when access is approved."
        : result === "invalid"
          ? "That verification link is invalid or expired. Submit the request again to receive a fresh link."
          : "Email verification is temporarily unavailable. Please try the link again later."}
    </div>
  );
}

export function PublicInvestmentBetaSignIn({ enabled }: { enabled: boolean }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setError(null);
    try {
      await signIn("email", {
        email,
        callbackUrl: "/investment",
        redirect: false,
      });
      setStatus("sent");
    } catch {
      setStatus("idle");
      setError("We could not request a sign-in link. Please try again.");
    }
  }

  if (!enabled) {
    return (
      <p className="text-[12px] leading-5 text-[#0C1B33]/48">
        Passwordless beta sign-in is temporarily unavailable. Existing early-access requests remain recorded.
      </p>
    );
  }

  if (status === "sent") {
    return (
      <div className="flex gap-3" role="status" aria-live="polite">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#16A34A]" aria-hidden="true" />
        <p className="text-[12px] leading-5 text-[#0C1B33]/58">
          If this email has approved access, a one-time sign-in link is on its way.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label htmlFor="public-investment-sign-in-email" className="block">
        <span className="sr-only">Approved email address</span>
        <input
          id="public-investment-sign-in-email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Approved email address"
          className="h-11 w-full border border-[#0C1B33]/18 bg-white px-4 text-[14px] text-[#0C1B33] outline-none placeholder:text-[#0C1B33]/25 focus:border-[#2563EB]"
        />
      </label>
      {error ? <p className="text-[12px] text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={status === "submitting"}
        className="inline-flex h-11 w-full items-center justify-center gap-2 border border-[#0C1B33]/20 bg-white px-4 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33] hover:border-[#2563EB] hover:text-[#2563EB] disabled:opacity-50"
      >
        {status === "submitting" ? "Requesting..." : "Email me a sign-in link"}
        {status === "submitting" ? null : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
      </button>
    </form>
  );
}
