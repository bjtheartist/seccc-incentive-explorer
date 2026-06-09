import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-[#0C1B33]/10 bg-[#0C1B33] text-white">
      <div className="container mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          <div>
            <div className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-white/50 border border-white/20 px-2 py-1 inline-block mb-4">
              CSIM
            </div>
            <p className="text-sm text-white/40 leading-relaxed">
              Helping Chicago businesses discover and access economic
              incentives — from TIF districts and Opportunity Zones to
              Enterprise Zones and beyond.
            </p>
          </div>
          <div>
            <h3 className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-white/60 mb-4">
              Quick Links
            </h3>
            <ul className="space-y-3">
              {[
                { href: "/report", label: "Generate Report" },
                { href: "/programs", label: "Incentive Programs" },
                { href: "/map", label: "Explorer Map" },
                { href: "/locate", label: "Find Location by Sector" },
                { href: "/report?wv=2&rt=df", label: "Vacancy Report" },
                { href: "/faq", label: "FAQ" },
              ].map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-white/30 hover:text-white/80 transition-colors font-mono-bureau text-[11px] tracking-wide"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-white/60 mb-4">
              Get in Touch
            </h3>
            <ul className="space-y-3 text-sm text-white/40">
              <li>
                <a
                  href="tel:7737211999"
                  className="inline-flex items-center gap-2 hover:text-white/80 transition-colors font-mono-bureau text-[11px] tracking-wide"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                  </svg>
                  (773) 721-1999
                </a>
              </li>
              <li className="font-mono-bureau text-[11px] tracking-wide text-white/30">
                South East Chicago Chamber of Commerce
              </li>
            </ul>
          </div>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-white/15 to-transparent mt-10 mb-6" />
        <div className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-white/20 text-center">
          Chicago Site Incentive Map &middot;
          Data sourced from public city, county, state, and federal program
          references
        </div>
        <div className="font-mono-bureau text-[8px] tracking-[0.1em] text-white/15 text-center mt-2">
          Program details change over time &middot; verify with administrators
        </div>
      </div>
    </footer>
  );
}
