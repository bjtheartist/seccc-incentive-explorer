import type { Metadata } from "next";
import Link from "next/link";
import { getGrantsMember } from "@/lib/grants/auth";
import { GrantsStore } from "@/lib/grants/store";
import { GrantsWorkspace } from "@/components/grants/GrantsWorkspace";
import "./workspace.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Grants workspace",
  robots: { index: false, follow: false },
};
export default async function GrantsPage() {
  let initial;
  let unavailable = false;
  try {
    const member = await getGrantsMember();
    if (member) initial = await new GrantsStore().workspace(member);
  } catch {
    unavailable = true;
  }
  if (unavailable)
    return (
      <Gate
        title="Grants workspace is being configured"
        detail="The database connection or grants migration needs attention. Your existing Explorer account and reports remain available."
      />
    );
  if (!initial)
    return (
      <Gate
        title="A shared workspace for the team"
        detail="Sign in with an Explorer account that has been granted staff access."
      />
    );
  return <GrantsWorkspace initial={initial} />;
}
function Gate({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mx-auto my-20 max-w-xl rounded-2xl border border-slate-200 bg-white p-10">
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-emerald-700">
        Internal · Grants Matchmaker
      </p>
      <h1 className="text-3xl font-semibold text-[#0C1B33]">{title}</h1>
      <p className="my-5 text-slate-600">{detail}</p>
      <Link
        className="inline-block rounded-lg bg-[#0C1B33] px-5 py-3 text-white"
        href="/login?callbackUrl=%2Fadmin%2Fgrants"
      >
        Sign in to Explorer
      </Link>
    </div>
  );
}
