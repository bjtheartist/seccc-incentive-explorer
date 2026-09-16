// Popup surface. Every value from the API is written with textContent, never innerHTML.
(() => {
  "use strict";

  const form = document.getElementById("cie-form");
  const input = document.getElementById("cie-address");
  const submit = document.getElementById("cie-submit");
  const status = document.getElementById("cie-status");
  const resultBox = document.getElementById("cie-result");
  const recentSection = document.getElementById("cie-recent-section");
  const recentList = document.getElementById("cie-recent");

  // Shared with the service worker and the content script (lookup.js loads first).
  const safeHttpUrl = (globalThis.CieLookup && globalThis.CieLookup.safeHttpUrl) || (() => null);

  let busy = false;

  const show = (node, visible) => {
    if (!node) return;
    if (visible) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
  };

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function setStatus(text, isError) {
    status.textContent = text || "";
    status.className = isError ? "status is-error" : "status";
    show(status, Boolean(text));
  }

  function renderResult(result) {
    resultBox.textContent = "";
    resultBox.appendChild(make("p", "result-address", result.address));
    if (result.displayName) resultBox.appendChild(make("p", "result-place", result.displayName));

    const matched = Array.isArray(result.matched) ? result.matched : [];
    const layers = Array.isArray(result.layers) ? result.layers : [];
    resultBox.appendChild(make("h2", "section-title", "Incentive zones"));

    if (matched.length) {
      const list = make("ul", "zones");
      for (const layer of matched) {
        const item = make("li", "zone");
        item.appendChild(make("span", "dot"));
        item.appendChild(make("span", "zone-label", layer.label));
        if (layer.name) item.appendChild(make("span", "zone-name", layer.name));
        list.appendChild(item);
      }
      resultBox.appendChild(list);
      const rest = layers.length - matched.length;
      if (rest > 0) resultBox.appendChild(make("p", "note", `${rest} other layer${rest === 1 ? "" : "s"} checked, no match.`));
    } else {
      resultBox.appendChild(make("p", "note", `No zone matches here. ${layers.length} layers checked.`));
    }

    const programs = Array.isArray(result.programs) ? result.programs : [];
    if (programs.length) {
      resultBox.appendChild(make("h2", "section-title", "Top programs"));
      const list = make("ol", "programs");
      for (const program of programs) {
        const item = make("li", "program");
        const href = safeHttpUrl(program.url);
        if (href) {
          const link = make("a", "program-name", program.name);
          link.setAttribute("href", href);
          link.setAttribute("target", "_blank");
          link.setAttribute("rel", "noopener noreferrer");
          item.appendChild(link);
        } else {
          item.appendChild(make("span", "program-name", program.name));
        }
        if (program.level) item.appendChild(make("span", "tag", program.level));
        list.appendChild(item);
      }
      resultBox.appendChild(list);
    }

    const reportHref = safeHttpUrl(result.reportUrl);
    if (reportHref) {
      const report = make("a", "report", "Open full report");
      report.setAttribute("href", reportHref);
      report.setAttribute("target", "_blank");
      report.setAttribute("rel", "noopener noreferrer");
      resultBox.appendChild(report);
    }
    show(resultBox, true);
  }

  function renderRecent(items) {
    recentList.textContent = "";
    const rows = Array.isArray(items) ? items : [];
    for (const item of rows) {
      const li = document.createElement("li");
      const button = make("button", "recent-item");
      button.type = "button";
      button.appendChild(make("span", "recent-address", item.address));
      const count = Number(item.matchedCount) || 0;
      button.appendChild(make("span", "recent-count", `${count} zone${count === 1 ? "" : "s"}`));
      button.addEventListener("click", () => {
        input.value = item.address;
        runLookup(item.address);
      });
      li.appendChild(button);
      recentList.appendChild(li);
    }
    show(recentSection, rows.length > 0);
  }

  async function refreshRecent() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "cie_recent" });
      renderRecent(response && response.items);
    } catch {
      renderRecent([]);
    }
  }

  async function runLookup(address) {
    const query = String(address || "").trim().replace(/\s+/g, " ");
    if (!query || busy) return;
    busy = true;
    submit.disabled = true;
    show(resultBox, false);
    setStatus("Checking zones…", false);
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: "cie_lookup", address: query });
    } catch {
      response = { error: "The address service is temporarily unavailable. Try again in a minute." };
    }
    busy = false;
    submit.disabled = false;
    if (!response || response.error || !response.result) {
      setStatus((response && response.error) || "The address service is temporarily unavailable. Try again in a minute.", true);
      return;
    }
    setStatus("", false);
    renderResult(response.result);
    await refreshRecent();
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    runLookup(input.value);
  });

  refreshRecent();
  input.focus();
})();
