"use client";

import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CaseKey } from "@/lib/vacancy-cases";
import {
  buildVacancyCaseHref,
  VACANCY_WORKSPACE_URL_EVENT,
} from "@/lib/vacancy-workspace";

export function CaseCardLink({
  zip,
  caseKey,
  initialHref,
  selected,
  className,
  children,
}: {
  zip: string;
  caseKey: CaseKey;
  initialHref: string;
  selected: boolean;
  className: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [href, setHref] = useState(initialHref);

  const currentHref = useCallback(() => {
    if (typeof window === "undefined") return initialHref;
    return `${buildVacancyCaseHref(
      zip,
      caseKey,
      new URLSearchParams(window.location.search),
    )}#case-results`;
  }, [caseKey, initialHref, zip]);

  const syncHref = useCallback(() => setHref(currentHref()), [currentHref]);

  useEffect(() => {
    window.addEventListener(VACANCY_WORKSPACE_URL_EVENT, syncHref);
    return () => window.removeEventListener(VACANCY_WORKSPACE_URL_EVENT, syncHref);
  }, [syncHref]);

  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      syncHref();
      return;
    }
    event.preventDefault();
    const destination = currentHref();
    setHref(destination);
    router.push(destination);
  }

  return (
    <Link
      href={href}
      aria-current={selected ? "true" : undefined}
      onClick={navigate}
      onFocus={syncHref}
      onMouseEnter={syncHref}
      onContextMenu={syncHref}
      className={className}
    >
      {children}
    </Link>
  );
}
