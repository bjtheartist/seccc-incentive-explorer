import type { Metadata } from "next";
import "@fontsource/inter/300.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/playfair-display/400.css";
import "@fontsource/playfair-display/600.css";
import "@fontsource/playfair-display/700.css";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { SiteTrafficTracker } from "@/components/analytics/SiteTrafficTracker";
import { Analytics } from "@vercel/analytics/next";

export const metadata: Metadata = {
  title: "Chicago Site Incentive Map | Discover Business Incentives",
  description:
    "Discover which economic incentives your Chicago business may qualify for. Cross-reference mapped incentive layers — TIF districts, Opportunity Zones, Enterprise Zones, and more.",
  keywords: [
    "Chicago business incentives",
    "TIF district",
    "Opportunity Zone",
    "Enterprise Zone",
    "Chicago economic development",
    "small business grants",
    "SBIF",
    "incentive stacking",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen flex flex-col">
        <AuthProvider>
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
          <ServiceWorkerRegistrar />
          <SiteTrafficTracker />
          <Analytics />
        </AuthProvider>
      </body>
    </html>
  );
}
