import crypto from "node:crypto";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";

/** An unused admission journal. It is not settlement evidence or a payment event. */
export interface BrowserAuthorizationIntent {
  sessionId: string;
  requestId: string;
  queryId: string;
  grantEpoch: string;
  signer: string;
  network: "eip155:5042002" | "eip155:5042";
  token: string;
  gatewayContract: string;
  sourceId: string;
  offerId: string | null;
  kind: "fetch" | "citation";
  payee: string;
  amountMicroUsdc: number;
}

export interface AdmittedBrowserAuthorization extends BrowserAuthorizationIntent {
  nonce: string;
  createdAt: string;
}

export type BrowserAdmissionResult =
  | { status: "admitted"; intent: AdmittedBrowserAuthorization }
  | { status: "grant_or_cap_refused" };

const address = /^0x[0-9a-fA-F]{40}$/;
export function prepareBrowserAuthorizationIntent(input: BrowserAuthorizationIntent, profile: ArcNetworkProfile = ARC_TESTNET_PROFILE): AdmittedBrowserAuthorization {
  if (profile !== ARC_TESTNET_PROFILE && profile !== ARC_MAINNET_PROFILE) throw new Error("Unsupported browser admission profile");
  if (!input.sessionId || !input.requestId || !input.queryId || !input.grantEpoch || !input.sourceId ||
      !address.test(input.signer) || !address.test(input.payee) ||
      input.network !== profile.networkId ||
      input.token.toLowerCase() !== profile.usdcAddress.toLowerCase() ||
      input.gatewayContract.toLowerCase() !== profile.gatewayWallet.toLowerCase() ||
      !["fetch", "citation"].includes(input.kind) ||
      !Number.isSafeInteger(input.amountMicroUsdc) || input.amountMicroUsdc <= 0) {
    throw new Error("Invalid browser authorization intent");
  }
  return { ...input, nonce: `0x${crypto.randomBytes(32).toString("hex")}`, createdAt: new Date().toISOString() };
}
