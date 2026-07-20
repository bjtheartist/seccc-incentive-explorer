"use client";

/**
 * Minimal shared focus store for the vacancy report's two client islands:
 * cluster cards set a focus bbox, the map island reads it. The page is a
 * server component, so the islands can't share useState through props —
 * this is a 20-line external store instead of a context/provider rewrite.
 */

import { useSyncExternalStore } from "react";

export type FocusBbox = [number, number, number, number] | null;

let current: FocusBbox = null;
const listeners = new Set<() => void>();

export function setFocusBbox(bbox: FocusBbox): void {
  current = bbox;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFocusBbox(): FocusBbox {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
