import Link from "next/link";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function VerifyPublicInvestmentRequestPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const email = paramValue(params.email) || "";
  const token = paramValue(params.token) || "";
  const valid = Boolean(email.includes("@") && token);

  return (
    <main className="min-h-screen bg-[#FAF9F6] px-6 py-16 text-[#0C1B33]">
      <div className="mx-auto max-w-lg border border-[#0C1B33]/10 bg-white p-7 sm:p-9">
        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#2563EB]">
          Public Investment Analysis
        </span>
        <h1 className="mt-4 font-editorial text-[40px] leading-tight">Confirm your email address</h1>
        {valid ? (
          <>
            <p className="mt-4 text-[14px] leading-6 text-[#0C1B33]/55">
              Confirm that <strong className="font-semibold text-[#0C1B33]/75">{email}</strong> is the address
              you want us to use for this beta request.
            </p>
            <form method="post" action="/api/public-investment-early-access/verify" className="mt-7">
              <input type="hidden" name="email" value={email} />
              <input type="hidden" name="token" value={token} />
              <button className="w-full bg-[#0C1B33] px-5 py-3 font-mono-bureau text-[10px] uppercase tracking-[0.16em] text-white hover:bg-[#2563EB]">
                Verify email and submit for review
              </button>
            </form>
          </>
        ) : (
          <p className="mt-4 text-[14px] leading-6 text-[#0C1B33]/55">
            This verification link is incomplete. Submit the early-access request again for a fresh link.
          </p>
        )}
        <Link
          href="/public-investment-analysis"
          className="mt-6 inline-block font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#2563EB]"
        >
          Return to Public Investment Analysis
        </Link>
      </div>
    </main>
  );
}
