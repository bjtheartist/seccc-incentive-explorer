"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, KeyRound, Loader2, MapPin } from "lucide-react";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token")?.trim() || "";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Could not reset your password.");
      }
      router.replace("/login?reset=1");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not reset your password."
      );
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
            Choose a new password.
          </h1>
          <p className="text-white/50 text-sm leading-relaxed">
            Use at least eight characters. The reset link can only be used
            once.
          </p>
        </div>

        <div className="px-8 py-8">
          {token ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="mb-2 block font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-[#0C1B33]/45">
                  New password
                </span>
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  className="w-full border border-[#0C1B33]/10 px-4 py-3 text-sm text-[#0C1B33] focus:border-[#2563EB] focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-2 block font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-[#0C1B33]/45">
                  Confirm password
                </span>
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  className="w-full border border-[#0C1B33]/10 px-4 py-3 text-sm text-[#0C1B33] focus:border-[#2563EB] focus:outline-none"
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
                  <KeyRound className="h-3.5 w-3.5" />
                )}
                Update password
              </button>
            </form>
          ) : (
            <div className="border border-red-100 bg-red-50 px-4 py-4 text-sm leading-relaxed text-red-700">
              This password reset link is invalid. Request a new link to
              continue.
            </div>
          )}

          <div className="pt-7 text-center">
            <Link
              href={token ? "/login" : "/forgot-password"}
              className="inline-flex items-center gap-2 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-[#0C1B33]/45 hover:text-[#0C1B33]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {token ? "Back to sign in" : "Request a new link"}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
