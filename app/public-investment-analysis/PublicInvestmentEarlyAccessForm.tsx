"use client";

import { FormEvent, useRef, useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";

interface Fields {
  name: string;
  title: string;
  email: string;
  website: string;
}

const EMPTY_FIELDS: Fields = { name: "", title: "", email: "", website: "" };

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  placeholder,
}: {
  id: "name" | "title" | "email";
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email";
  autoComplete?: string;
  placeholder: string;
}) {
  return (
    <label htmlFor={`public-investment-${id}`} className="block">
      <span className="font-mono-bureau text-[10px] uppercase tracking-[0.16em] text-[#0C1B33]/55">
        {label}
      </span>
      <input
        id={`public-investment-${id}`}
        name={id}
        type={type}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        maxLength={id === "email" ? 254 : id === "title" ? 160 : 120}
        placeholder={placeholder}
        className="mt-2 h-12 w-full border border-[#0C1B33]/18 bg-white px-4 text-[15px] text-[#0C1B33] outline-none transition-colors placeholder:text-[#0C1B33]/25 focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/10"
      />
    </label>
  );
}

export function PublicInvestmentEarlyAccessForm() {
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [status, setStatus] = useState<"idle" | "submitting" | "success">("idle");
  const [error, setError] = useState<string | null>(null);
  const successRef = useRef<HTMLDivElement>(null);

  function update<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setError(null);

    try {
      const response = await fetch("/api/public-investment-early-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "We could not save your request. Please try again.",
        );
      }

      setFields(EMPTY_FIELDS);
      setStatus("success");
      window.setTimeout(() => successRef.current?.focus(), 0);
    } catch (submissionError) {
      setStatus("idle");
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "We could not save your request. Please try again.",
      );
    }
  }

  if (status === "success") {
    return (
      <div
        ref={successRef}
        tabIndex={-1}
        className="border-t-2 border-[#16A34A] py-8 outline-none"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 className="h-8 w-8 text-[#16A34A]" aria-hidden="true" />
        <h2 className="mt-5 font-editorial text-[36px] leading-tight text-[#0C1B33]">
          You&apos;re on the early-access list.
        </h2>
        <p className="mt-3 max-w-xl text-[14px] leading-6 text-[#0C1B33]/58">
          We&apos;ll contact you as Public Investment Analysis testing opens to more partners.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="border-t-2 border-[#9CA3AF] pt-7">
      <div className="grid gap-5">
        <Field
          id="name"
          label="Name"
          value={fields.name}
          onChange={(value) => update("name", value)}
          autoComplete="name"
          placeholder="Your name"
        />
        <Field
          id="title"
          label="Title"
          value={fields.title}
          onChange={(value) => update("title", value)}
          autoComplete="organization-title"
          placeholder="Executive director, business owner, analyst"
        />
        <Field
          id="email"
          label="Email address"
          type="email"
          value={fields.email}
          onChange={(value) => update("email", value)}
          autoComplete="email"
          placeholder="you@example.com"
        />
      </div>

      <div className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="public-investment-website">Website</label>
        <input
          id="public-investment-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={fields.website}
          onChange={(event) => update("website", event.target.value)}
        />
      </div>

      <p className="mt-5 text-[11px] leading-5 text-[#0C1B33]/42">
        We&apos;ll use these details only to contact you about Public Investment Analysis testing and early access.
      </p>

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
        {status === "submitting" ? "Submitting..." : "Request early access"}
        {status === "submitting" ? null : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
      </button>
    </form>
  );
}
