"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, RotateCcw } from "lucide-react";

interface SignupFields {
  email: string;
  neighborhood: string;
  address: string;
  zipCode: string;
  consent: boolean;
  website: string;
}

const EMPTY_FIELDS: SignupFields = {
  email: "",
  neighborhood: "",
  address: "",
  zipCode: "",
  consent: false,
  website: "",
};

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  inputMode,
  maxLength,
  placeholder,
}: {
  id: keyof Pick<SignupFields, "email" | "neighborhood" | "address" | "zipCode">;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email";
  autoComplete?: string;
  inputMode?: "email" | "numeric" | "text";
  maxLength: number;
  placeholder: string;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="font-mono-bureau text-[10px] uppercase tracking-[0.16em] text-[#0C1B33]/55">
        {label}
      </span>
      <input
        id={id}
        name={id}
        type={type}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
        className="mt-2 h-12 w-full border border-[#0C1B33]/18 bg-white px-4 text-[15px] text-[#0C1B33] outline-none transition-colors placeholder:text-[#0C1B33]/25 focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/10"
      />
    </label>
  );
}

export function FutureCommerceSignupForm() {
  const [fields, setFields] = useState<SignupFields>(EMPTY_FIELDS);
  const [status, setStatus] = useState<"idle" | "submitting" | "success">("idle");
  const [error, setError] = useState<string | null>(null);
  const successRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === "success") {
      successRef.current?.scrollIntoView({ block: "center" });
    }
  }, [status]);

  function update<K extends keyof SignupFields>(key: K, value: SignupFields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setError(null);

    try {
      const response = await fetch("/api/future-of-commerce-signups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "We could not save your signup. Please try again.",
        );
      }

      setFields(EMPTY_FIELDS);
      setStatus("success");
    } catch (submissionError) {
      setStatus("idle");
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "We could not save your signup. Please try again.",
      );
    }
  }

  if (status === "success") {
    return (
      <div
        ref={successRef}
        className="border-t-2 border-[#16A34A] py-8"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 className="h-8 w-8 text-[#16A34A]" aria-hidden="true" />
        <h2 className="mt-5 font-editorial text-[36px] leading-tight text-[#0C1B33]">
          You&apos;re on the list.
        </h2>
        <p className="mt-3 max-w-xl text-[14px] leading-6 text-[#0C1B33]/58">
          We&apos;ll share occasional updates from CommuniData and Chicago Incentive Explorer.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-7 inline-flex h-11 items-center gap-2 border border-[#0C1B33]/18 bg-white px-4 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-[#0C1B33]/65 transition-colors hover:border-[#0C1B33]/35 hover:text-[#0C1B33]"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Add another signup
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="border-t-2 border-[#2563EB] pt-7">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="email"
          label="Email address"
          type="email"
          value={fields.email}
          onChange={(value) => update("email", value)}
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          placeholder="you@example.com"
        />
        <Field
          id="neighborhood"
          label="Neighborhood"
          value={fields.neighborhood}
          onChange={(value) => update("neighborhood", value)}
          autoComplete="address-level3"
          maxLength={100}
          placeholder="South Chicago"
        />
        <Field
          id="address"
          label="Business or project address"
          value={fields.address}
          onChange={(value) => update("address", value)}
          autoComplete="street-address"
          maxLength={220}
          placeholder="1234 E 87th Street"
        />
        <Field
          id="zipCode"
          label="ZIP code"
          value={fields.zipCode}
          onChange={(value) => update("zipCode", value.replace(/\D/g, "").slice(0, 5))}
          autoComplete="postal-code"
          inputMode="numeric"
          maxLength={5}
          placeholder="60617"
        />
      </div>

      <div className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={fields.website}
          onChange={(event) => update("website", event.target.value)}
        />
      </div>

      <label className="mt-6 flex items-start gap-3 border-y border-[#0C1B33]/10 py-4 text-[13px] leading-5 text-[#0C1B33]/62">
        <input
          name="consent"
          type="checkbox"
          required
          checked={fields.consent}
          onChange={(event) => update("consent", event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#2563EB]"
        />
        <span>
          Yes, email me occasional updates from CommuniData and Chicago Incentive Explorer about local business resources, incentive opportunities, and events. I can unsubscribe at any time.
        </span>
      </label>

      {error ? (
        <p className="mt-4 border-l-2 border-red-600 pl-3 text-[13px] text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="mt-6 inline-flex h-12 min-w-48 items-center justify-center gap-2 bg-[#0C1B33] px-6 font-mono-bureau text-[10px] uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#2563EB] disabled:cursor-wait disabled:opacity-60"
      >
        {status === "submitting" ? "Joining..." : "Join the email list"}
        {status === "submitting" ? null : (
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}
