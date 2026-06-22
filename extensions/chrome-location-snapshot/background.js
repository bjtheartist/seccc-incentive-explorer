/* global chrome */

const SITE_URL = "https://chicagoincentiveexplorer.com";
const CONTEXT_MENU_ID = "cie-run-location-snapshot";

function buildLookupUrl(address) {
  const url = new URL("/lookup", SITE_URL);
  url.searchParams.set("addr", address.trim());
  url.searchParams.set("source", "chrome-extension");
  return url.toString();
}

function openLookup(address) {
  const cleaned = String(address || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return;
  chrome.tabs.create({ url: buildLookupUrl(cleaned) });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Run Chicago Incentive Snapshot for "%s"',
      contexts: ["selection"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  openLookup(info.selectionText);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "openLookup") return false;
  openLookup(message.address);
  sendResponse({ ok: true });
  return false;
});
