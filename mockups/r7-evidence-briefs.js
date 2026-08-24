(function () {
  "use strict";

  const body = document.body;
  const currentBrief = body.dataset.currentBrief || "investment";
  const search = new URLSearchParams(window.location.search);

  if (!search.has("brief")) {
    search.set("brief", currentBrief);
    const nextUrl = `${window.location.pathname}?${search.toString()}${window.location.hash}`;
    window.history.replaceState({ brief: currentBrief }, "", nextUrl);
  }

  document.querySelectorAll("[data-brief-link]").forEach((link) => {
    const brief = link.dataset.briefLink;
    const href = new URL(link.getAttribute("href"), window.location.href);
    href.searchParams.set("brief", brief);
    link.setAttribute("href", `${href.pathname.split("/").pop()}?${href.searchParams.toString()}`);
  });

  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons({ attrs: { "aria-hidden": "true" } });
  }

  const toast = document.querySelector("[data-toast]");
  let toastTimer = null;

  function announce(message) {
    if (!toast) return;
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("visible");
    toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
  }

  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    const focusTarget = dialog.querySelector("[data-dialog-close], a, button");
    focusTarget?.focus();
  }

  document.querySelectorAll("[data-dialog-open]").forEach((trigger) => {
    trigger.addEventListener("click", () => {
      const dialog = document.getElementById(trigger.dataset.dialogOpen);
      openDialog(dialog);
    });
  });

  document.querySelectorAll("[data-dialog-close]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog")?.close());
  });

  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  document.querySelectorAll("[data-mark-label]").forEach((mark) => {
    mark.addEventListener("click", () => {
      const statusId = mark.dataset.markStatus;
      const status = statusId ? document.getElementById(statusId) : null;
      if (status) status.textContent = mark.dataset.markLabel;
      announce(mark.dataset.markLabel);
    });
  });

  document.querySelectorAll("[data-table-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.closest("[data-table-switcher]");
      if (!group) return;
      const view = button.dataset.tableView;

      group.querySelectorAll("[data-table-view]").forEach((candidate) => {
        candidate.setAttribute("aria-selected", candidate === button ? "true" : "false");
      });

      const panel = group.parentElement;
      panel.querySelectorAll("[data-table-panel]").forEach((table) => {
        table.hidden = table.dataset.tablePanel !== view;
      });

      announce(`Showing leading philanthropic ${view}. Illustrative sample data.`);
    });
  });

  const permitDialog = document.getElementById("permit-record-dialog");
  const recordFields = permitDialog
    ? Object.fromEntries(
        Array.from(permitDialog.querySelectorAll("[data-record-field]")).map((node) => [
          node.dataset.recordField,
          node,
        ]),
      )
    : {};

  document.querySelectorAll("[data-permit-record]").forEach((button) => {
    button.addEventListener("click", () => {
      Object.entries(recordFields).forEach(([key, node]) => {
        const value = button.dataset[key] || "Unavailable in this illustrative record";
        node.textContent = value;
      });
      openDialog(permitDialog);
    });
  });

  const briefText = {
    investment: [
      "CHICAGO INCENTIVE EXPLORER — PUBLIC INVESTMENT ANALYSIS · CHATHAM",
      "ILLUSTRATIVE SAMPLE DATA — NOT A PRODUCTION EXPORT",
      "",
      "Capital classes (different financial instruments; do not add them together):",
      "- Awarded grants: $142,000,000",
      "- Authorized TIF: $512,000,000",
      "- Federal program commitments: $74,000,000",
      "- Published state appropriations: $38,000,000",
      "- Credit capital: $86,000,000",
      "- Announced private capital: $510,000,000",
      "",
      "Awarded-grant lens:",
      "- Philanthropic awarded dollars: $42,700,000 (30.1% of awarded grants)",
      "- Top-three aggregated philanthropic recipient share: 65.6%",
      "- Award timing is not proof of receipt or expenditure.",
      "",
      "Cannot prove: funds received, funds currently available, funds remaining or unspent, project completion, causal impact, neighborhood-wide benefit, or program eligibility.",
      "Foundation records may reflect a grantee headquarters rather than where every dollar was spent.",
      "Community totals exclude citywide and intermediary rows unless a local project location is published.",
    ].join("\n"),
    permits: [
      "CHICAGO INCENTIVE EXPLORER — PERMIT ACTIVITY ANALYSIS · CHATHAM",
      "ILLUSTRATIVE SAMPLE DATA — NOT A PRODUCTION EXPORT",
      "",
      "Recorded filings: 1,248",
      "Distinct addresses: 612",
      "Latest filing: August 20, 2026",
      "Source refreshed: August 23, 2026 8:15 AM CT",
      "",
      "The aggregate summary covers 1,248 matching geocoded records. The illustrative recent-record ledger shows 4 of 67 returned rows and is truncated.",
      "A recorded zero is different from an unavailable lookup.",
      "",
      "Permit records show filing activity, not that construction started or finished. They do not establish current activity, occupancy, code compliance, project value, or the absence of work when no record is found.",
    ].join("\n"),
  };

  document.querySelectorAll("[data-download-brief]").forEach((button) => {
    button.addEventListener("click", () => {
      const brief = button.dataset.downloadBrief;
      const contents = briefText[brief];
      if (!contents) return;

      const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        brief === "investment"
          ? "illustrative-public-investment-brief.txt"
          : "illustrative-permit-activity-brief.txt";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 500);
      announce("Illustrative plain-text brief downloaded.");
    });
  });

  function applyPermitStatePreview() {
    if (currentBrief !== "permits") return;
    const state = search.get("state");
    if (!state || state === "partial") return;

    const charts = document.querySelector("[data-permit-charts]");
    const ledger = document.querySelector("[data-permit-ledger]");
    const banner = document.querySelector("[data-state-banner]");
    const stats = document.querySelector("[data-permit-stats]");

    if (state === "zero") {
      charts?.setAttribute("hidden", "");
      ledger?.setAttribute("hidden", "");
      if (stats) {
        stats.querySelector('[data-stat="filings"] .metric-value').textContent = "0";
        stats.querySelector('[data-stat="addresses"] .metric-value').textContent = "0";
        stats.querySelector('[data-stat="latest"] .metric-value').textContent = "None";
      }
      if (banner) {
        banner.hidden = false;
        banner.innerHTML =
          "<strong>0 recorded filings in this geocoded source window.</strong> This is a valid-zero illustrative state, not evidence that no work occurred.";
      }
    }

    if (state === "unavailable" || state === "malformed") {
      charts?.setAttribute("hidden", "");
      ledger?.setAttribute("hidden", "");
      if (stats) {
        stats.querySelectorAll(".metric-value").forEach((value) => {
          value.textContent = "Unavailable";
        });
      }
      if (banner) {
        banner.hidden = false;
        banner.innerHTML = state === "malformed"
          ? "<strong>Source response malformed.</strong> Required fields could not be parsed, so the prototype withholds charts instead of substituting zero. Retry or verify against the official publisher."
          : "<strong>Source lookup unavailable.</strong> No usable response was returned, so the prototype withholds charts instead of substituting zero. Retry or verify against the official publisher.";
      }
    }
  }

  applyPermitStatePreview();
})();
