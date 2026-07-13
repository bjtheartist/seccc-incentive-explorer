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
import { SiteConciergeProvider } from "@/components/concierge/SiteConciergeProvider";
import { Analytics } from "@vercel/analytics/next";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_KEYWORDS,
  DEFAULT_TITLE,
  ORGANIZATION_NAME,
  SITE_NAME,
  SITE_URL,
} from "@/lib/seo";
import { StructuredData } from "./seo-structured-data";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: {
    default: DEFAULT_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  keywords: DEFAULT_KEYWORDS,
  authors: [{ name: ORGANIZATION_NAME, url: SITE_URL }],
  creator: ORGANIZATION_NAME,
  publisher: ORGANIZATION_NAME,
  category: "business",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [
      {
        url: "/chicago-map-hero.png",
        width: 1200,
        height: 630,
        alt: "Chicago Incentive Explorer map interface",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: ["/chicago-map-hero.png"],
  },
  icons: {
    icon: "/icon.svg",
  },
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
          <SiteConciergeProvider>
            <Header />
            <StructuredData />
            <main className="flex-1">{children}</main>
            <Footer />
            <ServiceWorkerRegistrar />
            <SiteTrafficTracker />
            <Analytics />
          </SiteConciergeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
