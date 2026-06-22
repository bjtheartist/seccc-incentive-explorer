/* global chrome */

const form = document.querySelector("#lookup-form");
const addressInput = document.querySelector("#address");
const statusEl = document.querySelector("#status");
const recentSection = document.querySelector("#recent-section");
const recentList = document.querySelector("#recent-list");

function cleanAddress(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function setStatus(message) {
  statusEl.textContent = message;
}

function openLookup(address) {
  chrome.runtime.sendMessage({ type: "openLookup", address });
}

async function getRecentAddresses() {
  const stored = await chrome.storage.local.get({ recentAddresses: [] });
  return Array.isArray(stored.recentAddresses) ? stored.recentAddresses : [];
}

async function saveRecentAddress(address) {
  const existing = await getRecentAddresses();
  const next = [address, ...existing.filter((item) => item !== address)].slice(0, 5);
  await chrome.storage.local.set({ recentAddresses: next });
}

function renderRecent(addresses) {
  recentList.innerHTML = "";
  recentSection.hidden = addresses.length === 0;

  for (const address of addresses) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = address;
    button.addEventListener("click", () => {
      addressInput.value = address;
      openLookup(address);
    });
    recentList.append(button);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const address = cleanAddress(addressInput.value);

  if (!address) {
    setStatus("Enter an address first.");
    addressInput.focus();
    return;
  }

  setStatus("");
  await saveRecentAddress(address);
  openLookup(address);
  window.close();
});

getRecentAddresses().then(renderRecent);
addressInput.focus();
