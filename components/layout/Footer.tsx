import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-[#0C1B33]/10 bg-[#0C1B33] text-white">
      <div className="container mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          <div>
            <div className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-white/50 border border-white/20 px-2 py-1 inline-block mb-4">
              CHI
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
                { href: "/programs", label: "Incentive Programs" },
                { href: "/insights", label: "Data Insights" },
                { href: "/map", label: "Zone Map" },
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
              Contact
            </h3>
            <ul className="space-y-3 text-sm text-white/40">
              <li className="font-mono-bureau text-[11px] tracking-wide">
                Chicago Incentive Explorer
              </li>
              <li>
                <a
                  href="tel:7737211999"
                  className="font-mono-bureau text-[11px] tracking-wide hover:text-white/80 transition-colors"
                >
                  (773) 721-1999
                </a>
              </li>
              <li>
                <a
                  href="https://www.secchicago.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono-bureau text-[11px] tracking-wide hover:text-white/80 transition-colors"
                >
                  www.secchicago.org
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-white/15 to-transparent mt-10 mb-6" />
        <div className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-white/20 text-center">
          Chicago Incentive Explorer &middot;
          Data sourced from City of Chicago, State of Illinois &amp; Federal
          programs
        </div>
      </div>
    </footer>
  );
}
