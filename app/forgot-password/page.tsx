"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Mail,
  MapPin,
} from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Could not request a reset link.");
      }
      setMessage(
        body.message ||
          "If an account exists for that email, a password reset link is on its way."
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not request a reset link."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md bg-white border border-[#0C1B33]/10 shadow-xl">
        <div className="bg-[#0C1B33] px-8 py-10">
          <div className="inline-flex items-center gap-2 font-mono-bureau text-[10px] tracking-[0.25em] uppercase text-white/45 mb-5">
            <MapPin className="w-3.5 h-3.5" />
            Chicago Incentive Explorer
          </div>
          <h1 className="font-editorial text-3xl text-white leading-tight mb-3">
            Reset your password.
          </h1>
          <p className="text-white/50 text-sm leading-relaxed">
            Enter the email used for your workspace. We will send a one-time
            link that expires in one hour.
          </p>
        </div>

        <div className="px-8 py-8">
          {message ? (
            <div className="space-y-6">
              <div className="flex gap-3 border border-emerald-100 bg-emerald-50 px-4 py-4 text-sm leading-relaxed text-emerald-800">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{message}</p>
              </div>
              <p className="text-[12px] leading-relaxed text-[#0C1B33]/45">
                Check your spam folder if the email does not appear within a
                few minutes.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="mb-2 block font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-[#0C1B33]/45">
                  Account email
                </span>
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  className="w-full border border-[#0C1B33]/10 px-4 py-3 text-sm text-[#0C1B33] placeholder:text-[#0C1B33]/25 focus:border-[#2563EB] focus:outline-none"
                />
              </label>

              {error && (
                <p className="border border-red-100 bg-red-50 px-3 py-2 text-[12px] text-red-600">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex w-full items-center justify-center gap-2 bg-[#0C1B33] px-5 py-3.5 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-white transition-colors hover:bg-[#172844] disabled:cursor-default disabled:opacity-60"
              >
                {isSubmitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Mail className="h-3.5 w-3.5" />
                )}
                Email reset link
              </button>
            </form>
          )}

          <div className="pt-7 text-center">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-[#0C1B33]/45 hover:text-[#0C1B33]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
