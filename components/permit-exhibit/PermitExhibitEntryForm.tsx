"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";
import { formatPin14, normalizePin14 } from "@/lib/cook-viewer";

/**
 * The /permit-exhibit entry: a PIN input, an address-assist lookup that
 * reuses the SAME address -> PIN resolution path the report flow already
 * relies on (geocode via /api/geocode, then resolve the parcel/PIN via
 * /api/parcel — the same two calls components/lookup/AddressSearch.tsx and
 * app/report/page.tsx's parcel resolution already make against these
 * routes), and the radius picker (250/500/1000 ft, default 500).
 *
 * `radiusOptions`/`defaultRadiusFt` are passed down as plain data from the
 * server-component page rather than imported from lib/permit-exhibit.ts
 * directly — that module transitively reaches node:fs/getSQL (the spine's
 * own DB + archive-index reads), and a "use client" file may never
 * statically reach it (lib/__tests__/no-internal-catalog-in-client-bundle.test.ts
 * enforces this repo-wide, the same guard that caught
 * lib/investment-analysis.ts in an earlier client-bundle break).
 */
export function PermitExhibitEntryForm({
  radiusOptions,
  defaultRadiusFt,
}: {
  radiusOptions: readonly number[];
  defaultRadiusFt: number;
}) {
  const router = useRouter();
  const [pinInput, setPinInput] = useState("");
  const [addressInput, setAddressInput] = useState("");
  const [radiusFt, setRadiusFt] = useState<number>(defaultRadiusFt);
  const [addressStatus, setAddressStatus] = useState<"idle" | "loading">("idle");
  const [addressError, setAddressError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  function goToExhibit(pin: string) {
    router.push(`/permit-exhibit/${pin}?radius=${radiusFt}`);
  }

  function submitPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pin = normalizePin14(pinInput);
    if (!pin) {
      setPinError("Enter a 14-digit Cook County PIN (dashes optional).");
      return;
    }
    setPinError(null);
    goToExhibit(pin);
  }

  async function submitAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!addressInput.trim()) return;
    setAddressStatus("loading");
    setAddressError(null);
    try {
      const geo = await fetch(`/api/geocode?address=${encodeURIComponent(addressInput)}`).then((res) => {
        if (!res.ok) throw new Error("not_found");
        return res.json() as Promise<{ lat: number; lon: number; displayName?: string }>;
      });

      const parcelParams = new URLSearchParams({
        lat: String(geo.lat),
        lon: String(geo.lon),
        address: geo.displayName || addressInput,
      });
      const parcelRes = await fetch(`/api/parcel?${parcelParams.toString()}`);
      if (parcelRes.status === 204) throw new Error("no_parcel");
      if (!parcelRes.ok) throw new Error("parcel_lookup_failed");
      const parcel = (await parcelRes.json()) as { pin?: string; addressMatch?: string };
      const pin = normalizePin14(parcel.pin);
      if (!pin) throw new Error("no_parcel");

      setAddressStatus("idle");
      setPinInput(formatPin14(pin) ?? pin);
      goToExhibit(pin);
    } catch {
      setAddressStatus("idle");
      setAddressError(
        "Couldn't resolve a parcel PIN for that address. Try a more specific street address, or enter the PIN directly.",
      );
    }
  }

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <form
        onSubmit={submitPin}
        className="border border-[#0C1B33]/12 bg-white p-5"
        aria-labelledby="permit-exhibit-pin-form-title"
      >
        <p id="permit-exhibit-pin-form-title" className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/50">
          Have the PIN?
        </p>
        <label className="mt-3 block">
          <span className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#0C1B33]/48">
            Cook County PIN
          </span>
          <input
            name="pin"
            placeholder="20-36-323-008-0000"
            value={pinInput}
            onChange={(event) => setPinInput(event.target.value)}
            className="mt-2 h-11 w-full border border-[#0C1B33]/15 px-3 font-mono-bureau text-[14px] outline-none focus:border-[#2563EB]"
          />
        </label>
        {pinError ? (
          <p className="mt-2 text-[12px] text-red-700" role="alert">
            {pinError}
          </p>
        ) : null}
        <button
          type="submit"
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 bg-[#0C1B33] px-5 py-3 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-white transition-colors hover:bg-[#2563EB]"
        >
          Build exhibit
          <ArrowRight aria-hidden className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </form>

      <form
        onSubmit={submitAddress}
        className="border border-[#0C1B33]/12 bg-white p-5"
        aria-labelledby="permit-exhibit-address-form-title"
      >
        <p id="permit-exhibit-address-form-title" className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/50">
          Only have the address?
        </p>
        <label className="mt-3 block">
          <span className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#0C1B33]/48">
            Street address
          </span>
          <input
            name="address"
            placeholder="8525 S Euclid Ave"
            value={addressInput}
            onChange={(event) => setAddressInput(event.target.value)}
            className="mt-2 h-11 w-full border border-[#0C1B33]/15 px-3 text-[14px] outline-none focus:border-[#2563EB]"
          />
        </label>
        {addressError ? (
          <p className="mt-2 text-[12px] text-red-700" role="alert">
            {addressError}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={addressStatus === "loading" || !addressInput.trim()}
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 border border-[#0C1B33]/25 px-5 py-3 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-[#0C1B33]/75 transition-colors hover:border-[#2563EB] hover:text-[#2563EB] disabled:cursor-wait disabled:opacity-50"
        >
          <Search aria-hidden className="h-3.5 w-3.5" strokeWidth={1.8} />
          {addressStatus === "loading" ? "Looking up PIN..." : "Look up PIN from address"}
        </button>
      </form>

      <div className="border border-[#0C1B33]/12 bg-white p-5 lg:col-span-2">
        <p className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/50">Search radius</p>
        <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Search radius">
          {radiusOptions.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={radiusFt === option}
              onClick={() => setRadiusFt(option)}
              className={`min-h-10 border px-4 py-2 font-mono-bureau text-[11px] uppercase tracking-[0.06em] transition-colors ${
                radiusFt === option
                  ? "border-[#2563EB] bg-[#2563EB]/8 text-[#2563EB]"
                  : "border-[#0C1B33]/15 text-[#0C1B33]/60 hover:border-[#0C1B33]/35"
              }`}
            >
              {option.toLocaleString("en-US")} ft
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-[#0C1B33]/45">
          The radius applies to Section S2 (area context) only — the subject parcel record in S1 is not
          affected by this setting.
        </p>
      </div>
    </div>
  );
}
