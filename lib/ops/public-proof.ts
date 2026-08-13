/**
 * Public labels for the Arc RPC backing Keryx's server-side reads.
 *
 * RPC URLs may contain a Canteen server token. The public proof surface therefore exposes only a
 * coarse provider label and never the URL, path, query string, or credentials themselves.
 */

export type PublicRpcProvider = "Canteen Arc RPC" | "Arc public RPC" | "Custom Arc RPC";

export function classifyArcRpcProvider(rpcUrl: string): PublicRpcProvider {
  try {
    const host = new URL(rpcUrl).hostname.toLowerCase();
    if (host === "rpc.testnet.arc-node.thecanteenapp.com") return "Canteen Arc RPC";
    if (host === "rpc.testnet.arc.network") return "Arc public RPC";
  } catch {
    // A malformed value is still custom configuration. Never echo it into a public response.
  }
  return "Custom Arc RPC";
}
