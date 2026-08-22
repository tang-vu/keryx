"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Return a hydration-safe browser origin without scheduling a mount-time state update.
 * The origin does not change during a page lifetime, so this external snapshot needs no events.
 */
export function useBrowserOrigin(serverOrigin = "https://keryx.cc") {
  return useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => serverOrigin,
  );
}
