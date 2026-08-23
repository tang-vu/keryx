/**
 * indexer-event-subscription.ts — live push channel for the registry indexer.
 *
 * Opens one WebSocket to the Arc RPC and eth_subscribes to the SourceRegistry's
 * logs. The payload is deliberately ignored: a push only *wakes* the indexer's
 * checkpointed getLogs pass, so there is exactly one code path that writes the
 * cache — idempotent, resumable, and immune to whatever the socket missed while
 * disconnected. viem's socket transport reconnects and resubscribes on its own,
 * and the indexer's heartbeat poll covers any gap regardless.
 *
 * No-ops (returns a noop cleanup) when the registry or the WS URL is unset —
 * offline dev, tests, or a deploy that opts out via KERYX_RPC_WS_URL="".
 */

import { createPublicClient, webSocket, type Address } from "viem";
import { arcTestnet } from "@/lib/chains";
import { config } from "@/lib/config";
import { REGISTRY_ABI } from "@/lib/registry/registry-client";
import { safeErrorMessage } from "@/lib/ops/safe-error-message";

/**
 * Subscribe to registry log pushes; call `onActivity` on every batch.
 * Returns a cleanup that closes the subscription. Never throws — a dead WS
 * endpoint must degrade to heartbeat-only indexing, not crash server boot.
 */
export function subscribeRegistryLogs(onActivity: () => void): () => void {
  if (!config.registryAddress || !config.rpcWsUrl) return () => {};

  try {
    const client = createPublicClient({
      chain: arcTestnet,
      transport: webSocket(config.rpcWsUrl, { keepAlive: true, reconnect: true }),
    });

    return client.watchEvent({
      address: config.registryAddress as Address,
      events: REGISTRY_ABI.filter(
        (e): e is (typeof REGISTRY_ABI)[number] & { type: "event" } => e.type === "event",
      ),
      onLogs: () => onActivity(),
      onError: (err) => {
        // Transient socket errors are expected across a long-lived process; the
        // transport reconnects and the heartbeat keeps indexing meanwhile.
        console.warn("[keryx indexer] ws subscription error:", safeErrorMessage(err));
      },
    });
  } catch (err) {
    console.warn(
      "[keryx indexer] ws subscription unavailable, heartbeat-only:",
      safeErrorMessage(err),
    );
    return () => {};
  }
}
