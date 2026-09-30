import crypto from "node:crypto";

/** An unused admission journal. It is not settlement evidence or a payment event. */
export interface BrowserAuthorizationIntent {
  sessionId: string;
  requestId: string;
  queryId: string;
  grantEpoch: string;
  signer: string;
  network: "eip155:5042002";
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
export function prepareBrowserAuthorizationIntent(input: BrowserAuthorizationIntent): AdmittedBrowserAuthorization {
  if (!input.sessionId || !input.requestId || !input.queryId || !input.grantEpoch || !input.sourceId ||
      !address.test(input.signer) || !address.test(input.payee) ||
      input.network !== "eip155:5042002" ||
      input.token.toLowerCase() !== "0x3600000000000000000000000000000000000000" ||
      input.gatewayContract.toLowerCase() !== "0x0077777d7eba4688bdef3e311b846f25870a19b9" ||
      !["fetch", "citation"].includes(input.kind) ||
      !Number.isSafeInteger(input.amountMicroUsdc) || input.amountMicroUsdc <= 0) {
    throw new Error("Invalid browser authorization intent");
  }
  return { ...input, nonce: `0x${crypto.randomBytes(32).toString("hex")}`, createdAt: new Date().toISOString() };
}
