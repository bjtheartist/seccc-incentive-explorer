// Per-site address readers. Each parser is a pure function of a document, so the
// tests can run it under LinkeDOM and a second site is a drop-in addition.
(() => {
  const collapse = value => String(value === undefined || value === null ? "" : value).trim().replace(/\s+/g, " ");

  // Cook County Assessor: a "PIN & Address" block of label/detail pairs.
  function detailValue(root, label) {
    const rows = root && root.querySelectorAll ? Array.from(root.querySelectorAll(".detail-row")) : [];
    for (const row of rows) {
      const labelNode = row.querySelector(".detail-row--label");
      if (!labelNode) continue;
      if (collapse(labelNode.textContent).toLowerCase() !== label.toLowerCase()) continue;
      const detail = row.querySelector(".detail-row--detail");
      const text = detail ? collapse(detail.textContent) : "";
      if (text) return text;
    }
    return "";
  }

  function cookCountyAssessor(document) {
    if (!document) return null;
    const address = detailValue(document, "Address");
    const city = detailValue(document, "City");
    const pin = detailValue(document, "Pin");
    // The Explorer only covers Chicago; a suburban PIN gets no panel at all.
    if (!address || city.toLowerCase() !== "chicago") return null;
    return { address, city, pin };
  }

  const PARSERS = [
    // The Assessor moved from cookcountyassessor.com to cookcountyassessoril.gov
    // (the .com now redirects); both stay listed so either URL gets the panel.
    { id: "cookCountyAssessor", hostSuffixes: ["cookcountyassessor.com", "cookcountyassessoril.gov"], parse: cookCountyAssessor }
  ];

  // hostname is optional: without it every parser is tried in order (used by tests).
  function parse(document, hostname) {
    const host = collapse(hostname).toLowerCase();
    const candidates = host
      ? PARSERS.filter(parser => parser.hostSuffixes.some(suffix => host === suffix || host.endsWith(`.${suffix}`)))
      : PARSERS;
    for (const parser of candidates) {
      try {
        const result = parser.parse(document);
        if (result && result.address) return result;
      } catch {
        // A broken parser must never break the host page.
      }
    }
    return null;
  }

  const api = { parse, cookCountyAssessor, PARSERS };
  globalThis.CieSiteParsers = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
