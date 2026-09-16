// Assessor PIN pages: read the address, run the same lookup as the popup, and
// hang a small panel off the "PIN & Address" block. Nothing here may break the page.
(() => {
  "use strict";

  const HOST_ID = "cie-incentive-check";
  // Shared with the popup and the service worker (lookup.js loads first).
  const safeHttpUrl = (globalThis.CieLookup && globalThis.CieLookup.safeHttpUrl) || (() => null);

  // Scoped to the shadow root, so the host page's CSS and ours never meet.
  const PANEL_CSS = `
    :host { all: initial; }
    .panel {
      font: 13px/1.45 Inter, system-ui, sans-serif;
      color: #0C1B33; background: #FAF9F6;
      border: 1px solid #D8DDE6; border-left: 2px solid #2563EB;
      padding: 10px 12px;
    }
    .eyebrow { font-size: 9px; letter-spacing: 0.09em; text-transform: uppercase; color: #5A6478; margin: 0 0 4px; }
    .title { font: 400 15px/1.2 "Playfair Display", Georgia, serif; margin: 0 0 6px; }
    .note { margin: 0; color: #5A6478; font-size: 12px; }
    .zones { list-style: none; margin: 6px 0 0; padding: 0; }
    .zone { display: flex; gap: 6px; align-items: baseline; padding: 3px 0; border-bottom: 1px solid #D8DDE6; }
    .dot { width: 5px; height: 5px; flex: none; background: #16A34A; }
    .zone-label { font-weight: 500; }
    .zone-name { color: #5A6478; font-size: 11px; margin-left: auto; text-align: right; }
    .heading { font-size: 9px; letter-spacing: 0.09em; text-transform: uppercase; color: #5A6478; margin: 10px 0 4px; font-weight: 600; }
    .programs { list-style: none; margin: 0; padding: 0; }
    .program { background: #E4ECF7; padding: 5px 8px; margin-bottom: 4px; }
    .program a, .program span.name { color: #0C1B33; text-decoration: none; font-weight: 500; }
    .program a:hover { color: #2563EB; text-decoration: underline; }
    .tag { display: inline-block; margin-left: 6px; padding: 0 5px; font-size: 9px; letter-spacing: 0.06em;
           text-transform: uppercase; color: #5A6478; background: #FAF9F6; border: 1px solid #D8DDE6; }
    .report { display: inline-block; margin-top: 8px; padding: 5px 10px; background: #2563EB; color: #fff;
              text-decoration: none; font-weight: 500; font-size: 12px; }
    .report:hover { background: #0C1B33; }
  `;

  function make(root, tag, className, text) {
    const node = root.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function anchorFor(doc) {
    const block = doc.querySelector(".property-details-info");
    if (block) return block;
    const headings = Array.from(doc.querySelectorAll("h2"));
    return headings.find(node => /pin\s*&\s*address/i.test(node.textContent || "")) || null;
  }

  function renderPanel(shadow, parsed, response) {
    const panel = make(document, "div", "panel");
    panel.appendChild(make(document, "p", "eyebrow", "Chicago Incentive Explorer"));
    panel.appendChild(make(document, "h3", "title", "Incentive Check"));

    if (!response || response.error || !response.result) {
      panel.appendChild(make(document, "p", "note", (response && response.error) ||
        "The address service is temporarily unavailable. Try again in a minute."));
      shadow.replaceChildren(panel);
      return;
    }

    const result = response.result;
    const matched = Array.isArray(result.matched) ? result.matched : [];
    const layers = Array.isArray(result.layers) ? result.layers : [];
    panel.appendChild(make(document, "p", "note", parsed.address));

    if (matched.length) {
      const list = make(document, "ul", "zones");
      for (const layer of matched) {
        const item = make(document, "li", "zone");
        item.appendChild(make(document, "span", "dot"));
        item.appendChild(make(document, "span", "zone-label", layer.label));
        if (layer.name) item.appendChild(make(document, "span", "zone-name", layer.name));
        list.appendChild(item);
      }
      panel.appendChild(list);
    } else {
      panel.appendChild(make(document, "p", "note", `No zone matches here. ${layers.length} layers checked.`));
    }

    const programs = Array.isArray(result.programs) ? result.programs : [];
    if (programs.length) {
      panel.appendChild(make(document, "p", "heading", "Top programs"));
      const list = make(document, "ol", "programs");
      for (const program of programs) {
        const item = make(document, "li", "program");
        const href = safeHttpUrl(program.url);
        if (href) {
          const link = make(document, "a", null, program.name);
          link.setAttribute("href", href);
          link.setAttribute("target", "_blank");
          link.setAttribute("rel", "noopener noreferrer");
          item.appendChild(link);
        } else {
          item.appendChild(make(document, "span", "name", program.name));
        }
        if (program.level) item.appendChild(make(document, "span", "tag", program.level));
        list.appendChild(item);
      }
      panel.appendChild(list);
    }

    const reportHref = safeHttpUrl(result.reportUrl);
    if (reportHref) {
      const report = make(document, "a", "report", "Open full report");
      report.setAttribute("href", reportHref);
      report.setAttribute("target", "_blank");
      report.setAttribute("rel", "noopener noreferrer");
      panel.appendChild(report);
    }
    shadow.replaceChildren(panel);
  }

  function run() {
    if (document.getElementById(HOST_ID)) return;
    const parsed = globalThis.CieSiteParsers && globalThis.CieSiteParsers.parse(document, location.hostname);
    if (!parsed) return;
    const anchor = anchorFor(document);
    if (!anchor || !anchor.parentNode) return;

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.className = "cie-host";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = PANEL_CSS;
    shadow.appendChild(style);

    const loading = make(document, "div", "panel");
    loading.appendChild(make(document, "p", "eyebrow", "Chicago Incentive Explorer"));
    loading.appendChild(make(document, "h3", "title", "Incentive Check"));
    loading.appendChild(make(document, "p", "note", "Checking incentive zones…"));
    shadow.appendChild(loading);
    anchor.parentNode.insertBefore(host, anchor.nextSibling);

    const keepStyle = () => {
      // replaceChildren drops the stylesheet, so re-attach it with each render.
      if (!shadow.querySelector("style")) shadow.insertBefore(style, shadow.firstChild);
    };

    Promise.resolve(chrome.runtime.sendMessage({ type: "cie_lookup", address: `${parsed.address}, Chicago, IL` }))
      .then(response => { renderPanel(shadow, parsed, response); keepStyle(); })
      .catch(() => { renderPanel(shadow, parsed, null); keepStyle(); });
  }

  try {
    run();
  } catch {
    // A failure here must leave the assessor page exactly as it was.
  }
})();
