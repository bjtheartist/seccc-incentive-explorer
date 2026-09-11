import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";
import { load } from "cheerio";
import { sourceUrl } from "./model";

export function publicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export function canonicalUrl(value: string) {
  const u = new URL(value);
  u.hash = "";
  for (const k of [...u.searchParams.keys()])
    if (/^(utm_|fbclid|gclid)/i.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  return u.toString().replace(/\/$/, "");
}
export function parseSource(html: string, url: string) {
  const $ = load(html);
  $("script,style,noscript,iframe,svg,nav,footer,header").remove();
  const title = $("title").text().trim().slice(0, 200) || new URL(url).hostname;
  const text = ($("main").length ? $("main").text() : $("body").text())
    .replace(/\s+/g, " ")
    .trim();
  if (
    text.length < 80 ||
    /^(access denied|just a moment|enable javascript)/i.test(title)
  )
    throw new Error(
      "Page blocked or contains too little readable text; review manually",
    );
  const links = new Map<string, string>();
  $("a[href]").each((_, a) => {
    const label = $(a).text().replace(/\s+/g, " ").trim();
    if (
      !/grant|funding|application|apply|opportunit|challenge|award/i.test(label)
    )
      return;
    try {
      const target = canonicalUrl(new URL($(a).attr("href")!, url).toString());
      if (
        sourceUrl.safeParse(target).success &&
        target !== canonicalUrl(url) &&
        !/\.(pdf|docx?|xlsx?|zip)$/i.test(new URL(target).pathname)
      )
        links.set(target, label.slice(0, 200));
    } catch {
      /* Ignore invalid or non-HTTP links. */
    }
  });
  return {
    title,
    text: text.slice(0, 100_000),
    links: [...links].slice(0, 80).map(([url, title]) => ({ url, title })),
  };
}

/** Pin the validated public IPv4 address for each request, including redirects. */
export async function fetchSource(
  value: string,
  redirects = 0,
  deadline = Date.now() + 20_000,
): Promise<{ url: string; html: string }> {
  if (Date.now() >= deadline)
    throw new Error("Source scan exceeded 20 seconds");
  const u = new URL(sourceUrl.parse(value));
  if (isIP(u.hostname) || !u.hostname.includes("."))
    throw new Error("Use a public hostname");
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(u.hostname, { family: 4, all: true }),
    new Promise<never>((_, reject) => {
      dnsTimer = setTimeout(
        () => reject(new Error("Source DNS lookup timed out")),
        Math.min(5000, deadline - Date.now()),
      );
    }),
  ]).finally(() => clearTimeout(dnsTimer));
  if (!addresses.length || addresses.some((a) => !publicIPv4(a.address)))
    throw new Error("Source resolves to a non-public address");
  const address = addresses[0].address;
  const result = await new Promise<{
    status: number;
    location?: string;
    html: string;
    type: string;
  }>((resolve, reject) => {
    const fail = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    const req = request(
      u,
      {
        method: "GET",
        agent: false,
        family: 4,
        lookup: (_host, options, callback) =>
          options.all
            ? callback(null, [{ address, family: 4 }])
            : callback(null, address, 4),
        headers: {
          "User-Agent": "ChicagoIncentiveExplorer-GrantResearch/1.0",
          Accept: "text/html,text/plain",
          "Accept-Encoding": "identity",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 1_500_000) {
            fail(new Error("Source exceeds 1.5 MB scan limit"));
            res.destroy();
            req.destroy();
          } else chunks.push(Buffer.from(chunk));
        });
        res.on("error", fail);
        res.on("aborted", () =>
          fail(new Error("Source response was interrupted")),
        );
        res.on("end", () => {
          clearTimeout(timer);
          resolve({
            status: res.statusCode || 0,
            location: res.headers.location,
            html: Buffer.concat(chunks).toString("utf8"),
            type: res.headers["content-type"] || "",
          });
        });
      },
    );
    const timer = setTimeout(
      () => {
        fail(new Error("Source request timed out"));
        req.destroy();
      },
      Math.min(10_000, Math.max(1, deadline - Date.now())),
    );
    req.on("error", fail);
    req.end();
  });
  if ([301, 302, 303, 307, 308].includes(result.status)) {
    if (!result.location || redirects >= 2)
      throw new Error("Too many redirects; update source URL");
    return fetchSource(
      new URL(result.location, u).toString(),
      redirects + 1,
      deadline,
    );
  }
  if (result.status !== 200)
    throw new Error(`Source returned HTTP ${result.status}`);
  if (!/text\/(html|plain)|application\/xhtml\+xml/i.test(result.type))
    throw new Error(
      "Automatic scan supports HTML/text; review this document manually",
    );
  return { url: u.toString(), html: result.html };
}
