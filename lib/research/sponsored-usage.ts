import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import type { PaymentGateway } from "../payments/payment-gateway";
import type { RunProvenance } from "./run-provenance";
import { createTrustedUsageContext, newRunUsage, USAGE_NETWORKS, type RunUsage } from "./usage-provenance";

/** Observe only the trusted web adapter's already-selected public trial gateway.
 * Mainnet no-browser getAgentDeps has admitted the dedicated hosted policy before
 * this call. This observation never selects, funds, signs or submits a payment.
 * A public body, historical fundingOwner or a wallet alone supplies no such fact. */
export function sponsoredUsageContext(input: {
  network: RunUsage["network"];
  queryId: string;
  origin: string;
  gateway: PaymentGateway;
  sponsored: boolean;
  scripted: boolean;
  asker?: string;
  provenance: RunProvenance;
  teamWallets: readonly string[];
}): object | undefined {
  if (!USAGE_NETWORKS.includes(input.network)) return;
  const fallback = () => input.scripted ? createTrustedUsageContext(input.network,
    { actor: "unknown", funding: "unknown", scripted: true }) : undefined;
  if (!input.sponsored || input.network !== "eip155:5042" || input.gateway.mode !== "real") return fallback();
  try {
    const origin = new URL(input.origin);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/" ||
      typeof input.queryId !== "string" || !/^[A-Za-z0-9:_-]{1,256}$/.test(input.queryId)) return fallback();
    const payer = input.gateway.agentAddress();
    if (!/^0x[0-9a-fA-F]{40}$/.test(payer) || /^0x0{40}$/i.test(payer)) return fallback();
    const actor = newRunUsage({ asker: input.asker, provenance: input.provenance }, input.network, input.teamWallets).cohort;
    const fundingEvidenceSha256 = createHash("sha256").update(canonicalJson({
      format: "keryx-public-trial-funding-observation-v1", queryId: input.queryId,
      network: input.network, origin: origin.origin, payer: payer.toLowerCase(), authority: "admitted-hosted-public-trial",
    })).digest("hex");
    return createTrustedUsageContext(input.network, { actor: actor === "team" ? "team" : "unknown",
      funding: "treasury", scripted: input.scripted, fundingEvidenceSha256 });
  } catch {
    // Missing instrumentation must not change the existing research/payment path.
    return fallback();
  }
}
