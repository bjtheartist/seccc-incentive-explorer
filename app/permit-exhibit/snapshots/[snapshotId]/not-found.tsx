import Link from "next/link";

export default function SavedPermitExhibitNotFound() {
  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-12 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-2xl border border-[#0C1B33]/12 bg-white p-7">
        <p className="font-mono-bureau text-[10px] uppercase tracking-[0.16em] text-[#2563EB]">Saved snapshot</p>
        <h1 className="mt-3 font-editorial text-[38px] leading-tight">That saved exhibit was not found.</h1>
        <p className="mt-4 text-[13px] leading-relaxed text-[#0C1B33]/60">
          Check the complete link or build a new exhibit. No current records were substituted for the missing snapshot.
        </p>
        <Link
          href="/permit-exhibit"
          className="mt-6 inline-flex min-h-11 items-center bg-[#0C1B33] px-5 py-3 font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-white hover:bg-[#2563EB]"
        >
          Build a new exhibit
        </Link>
      </div>
    </main>
  );
}
