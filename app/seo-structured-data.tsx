"use client";

import { usePathname } from "next/navigation";
import {
  buildBreadcrumbJsonLd,
  buildSiteJsonLd,
} from "@/lib/seo";

function JsonLdScript({ id, data }: { id: string; data: object }) {
  return (
    <script
      id={id}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

export function StructuredData() {
  const pathname = usePathname();
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(pathname);

  return (
    <>
      <JsonLdScript id="site-structured-data" data={buildSiteJsonLd()} />
      {breadcrumbJsonLd && (
        <JsonLdScript id="breadcrumb-structured-data" data={breadcrumbJsonLd} />
      )}
    </>
  );
}
