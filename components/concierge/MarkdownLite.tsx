"use client";

import React from "react";

/**
 * Deliberately tiny markdown renderer for concierge replies: bold, links, and
 * unordered/ordered lists only. Builds React elements (never dangerouslySet
 * HTML) and only allows http(s) or internal "/" links. Anything else renders as
 * plain text — a safe floor for streamed model output.
 */

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Split on **bold** and [label](url) while keeping delimiters.
  const pattern = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(pattern);
  parts.forEach((part, i) => {
    if (!part) return;
    const boldMatch = /^\*\*([^*]+)\*\*$/.exec(part);
    if (boldMatch) {
      nodes.push(
        <strong key={`${keyPrefix}-b-${i}`} className="font-semibold text-[#0C1B33]">
          {boldMatch[1]}
        </strong>
      );
      return;
    }
    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (linkMatch) {
      const label = linkMatch[1];
      const href = linkMatch[2].trim();
      const internal =
        href.startsWith("/") && !href.startsWith("//") && !href.includes("..");
      const safe = /^https?:\/\//i.test(href) || internal;
      if (safe) {
        const external = /^https?:\/\//i.test(href);
        nodes.push(
          <a
            key={`${keyPrefix}-l-${i}`}
            href={href}
            {...(external
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
            className="text-[#2563EB] underline decoration-[#2563EB]/40 underline-offset-2 hover:decoration-[#2563EB] break-words"
          >
            {label}
          </a>
        );
        return;
      }
      nodes.push(<React.Fragment key={`${keyPrefix}-t-${i}`}>{label}</React.Fragment>);
      return;
    }
    nodes.push(<React.Fragment key={`${keyPrefix}-p-${i}`}>{part}</React.Fragment>);
  });
  return nodes;
}

export function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let listItems: { ordered: boolean; content: string }[] = [];
  let key = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    const ordered = listItems[0].ordered;
    const items = listItems.map((li, i) => (
      <li key={`li-${key}-${i}`} className="leading-relaxed">
        {renderInline(li.content, `li-${key}-${i}`)}
      </li>
    ));
    blocks.push(
      ordered ? (
        <ol key={`ol-${key++}`} className="list-decimal pl-5 space-y-1 my-1.5">
          {items}
        </ol>
      ) : (
        <ul key={`ul-${key++}`} className="list-disc pl-5 space-y-1 my-1.5">
          {items}
        </ul>
      )
    );
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    const ulMatch = /^\s*[-*]\s+(.*)$/.exec(line);
    const olMatch = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ulMatch) {
      listItems.push({ ordered: false, content: ulMatch[1] });
      continue;
    }
    if (olMatch) {
      listItems.push({ ordered: true, content: olMatch[1] });
      continue;
    }
    flushList();
    if (line.trim() === "") continue;
    blocks.push(
      <p key={`p-${key++}`} className="leading-relaxed my-1.5">
        {renderInline(line, `p-${key}`)}
      </p>
    );
  }
  flushList();

  return <div className="text-[13px] text-[#0C1B33]/85">{blocks}</div>;
}
