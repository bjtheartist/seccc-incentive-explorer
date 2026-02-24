import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "Chicago Site Incentive Map | Discover Business Incentives",
  description:
    "Discover what economic incentives your Chicago business qualifies for. Cross-reference 11 incentive zone layers — TIF districts, Opportunity Zones, Enterprise Zones, and more.",
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
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
