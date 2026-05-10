"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, Mail, MapPin } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/workspace";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleEmailAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    try {
      if (mode === "signup") {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Could not create account.");
        }
      }

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl,
      });

      if (result?.error) {
        throw new Error("Email or password did not match.");
      }

      router.push(result?.url || callbackUrl);
      router.refresh();
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Something went wrong. Try again."
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
            Save your reports and next steps.
          </h1>
          <p className="text-white/50 text-sm leading-relaxed">
            Sign in to create a business workspace, choose a goal, and keep your
            incentive reports organized.
          </p>
        </div>
        <div className="px-8 py-8 space-y-5">
          <button
            onClick={() => signIn("google", { callbackUrl })}
            className="w-full inline-flex items-center justify-center gap-3 bg-[#2563EB] text-white px-5 py-3.5 font-mono-bureau text-[10px] tracking-[0.15em] uppercase hover:bg-[#1d4ed8] transition-colors cursor-pointer"
          >
            Continue with Google
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[#0C1B33]/10" />
            <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/25">
              Or
            </span>
            <div className="h-px flex-1 bg-[#0C1B33]/10" />
          </div>

          <div className="grid grid-cols-2 border border-[#0C1B33]/10">
            {[
              { id: "signin", label: "Sign in" },
              { id: "signup", label: "Sign up" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setMode(item.id as "signin" | "signup");
                  setMessage(null);
                }}
                className={`py-3 font-mono-bureau text-[10px] tracking-[0.15em] uppercase transition-colors ${
                  mode === item.id
                    ? "bg-[#0C1B33] text-white"
                    : "bg-white text-[#0C1B33]/40 hover:text-[#0C1B33]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleEmailAuth} className="space-y-3">
            {mode === "signup" && (
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Name"
                autoComplete="name"
                className="w-full border border-[#0C1B33]/10 px-4 py-3 text-sm text-[#0C1B33] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#2563EB]"
              />
            )}
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email"
              type="email"
              autoComplete="email"
              required
              className="w-full border border-[#0C1B33]/10 px-4 py-3 text-sm text-[#0C1B33] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#2563EB]"
            />
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={8}
              className="w-full border border-[#0C1B33]/10 px-4 py-3 text-sm text-[#0C1B33] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#2563EB]"
            />

            {message && (
              <p className="text-[12px] text-red-600 bg-red-50 border border-red-100 px-3 py-2">
                {message}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full inline-flex items-center justify-center gap-2 bg-[#0C1B33] text-white px-5 py-3.5 font-mono-bureau text-[10px] tracking-[0.15em] uppercase hover:bg-[#172844] transition-colors disabled:opacity-60 disabled:cursor-default"
            >
              {isSubmitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Mail className="w-3.5 h-3.5" />
              )}
              {mode === "signup" ? "Create account" : "Sign in with email"}
            </button>
          </form>

          <p className="text-[12px] text-[#0C1B33]/40 leading-relaxed text-center">
            You can still generate reports without an account. Login is only
            needed when you want to save a report or track project progress.
            Passwords are securely hashed before storage.
          </p>
          <div className="pt-3 text-center">
            <Link
              href="/report"
              className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/40 hover:text-[#0C1B33]"
            >
              Continue without saving
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
