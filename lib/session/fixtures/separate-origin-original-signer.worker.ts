/** TEST ONLY: no persistence, recovery, production custody or signer activation. */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSyntheticOriginalObservationClient } from "../browser-original-observation-client";
import { ObservationElapsedGuard } from "../../payments/browser-original-observation-protocol";
import {
  browserSigningTypedData,
  serializeBrowserSigningHeader,
} from "../../payments/browser-signing-original";
import { validateSessionPayment } from "../session-signing-policy";

interface FixtureBinding {
  backend: string;
  owner: string;
  sessionId: string;
  requestId: string;
  queryId: string;
  grantEpoch: string;
}
const account = privateKeyToAccount(generatePrivateKey());
let binding: Readonly<FixtureBinding> | undefined;
let attempted = false;
let busy = false;
let readSignatures = 0;
let paymentSignatures = 0;
let callbackFetchStarts = 0;
let producedPaymentSignatures = 0;
const measuredAccount: typeof account = {
  ...account,
  async signTypedData(parameters) {
    if (parameters.primaryType === "ObservationRequest") readSignatures++;
    else paymentSignatures++;
    const signature = await account.signTypedData(parameters);
    if (parameters.primaryType !== "ObservationRequest")
      producedPaymentSignatures++;
    return signature;
  },
};
function telemetry() {
  postMessage({
    type: "telemetry",
    attempted,
    busy,
    readSignatures,
    paymentSignatures,
    callbackFetchStarts,
    producedPaymentSignatures,
  });
}
postMessage({ type: "ready", address: account.address.toLowerCase() });
telemetry();
onmessage = async (event: MessageEvent) => {
  const message = event.data;
  if (message?.command === "configure" && !binding && !attempted) {
    // Privileged harness supplies only public bindings, never an original or secret.
    binding = Object.freeze({ ...message.binding });
    postMessage({ type: "configured" });
    return;
  }
  if (message?.command !== "sign" || !binding || attempted) {
    postMessage({
      type: "status",
      correlationId: message?.correlationId,
      status: "refused",
    });
    return;
  }
  attempted = true;
  busy = true;
  telemetry();
  const fixed = binding;
  const life = new ObservationElapsedGuard();
  let status = "refused";
  try {
    const observation = await createSyntheticOriginalObservationClient(
      measuredAccount,
      fixed.backend
    ).observe({ sessionId: fixed.sessionId, requestId: fixed.requestId });
    life.live();
    if (!observation) throw new Error("Fixture refused");
    const state = observation.state;
    const original = state.original;
    const grant = state.currentGrant;
    // Modeled trusted backend UTC, not browser UTC or an atomic signing permission.
    const utc = Number(observation.readInterval.finishedAtMs);
    if (
      !state.active ||
      !grant ||
      grant.expiry <= utc + 5000 ||
      grant.sessionId !== fixed.sessionId ||
      grant.sessAddr.toLowerCase() !== account.address.toLowerCase() ||
      grant.ownerAddr.toLowerCase() !== fixed.owner ||
      grant.grantEpoch !== fixed.grantEpoch ||
      state.policy.policy.owner !== fixed.owner ||
      state.policy.policy.signer !== account.address.toLowerCase() ||
      state.policy.policy.expiresAt <= utc + 5000 ||
      state.policy.policy.grantEpoch !== fixed.grantEpoch ||
      original.queryId !== fixed.queryId ||
      original.grantEpoch !== fixed.grantEpoch ||
      state.journal.grantEpoch !== fixed.grantEpoch ||
      state.journal.phase !== "exposed"
    )
      throw new Error("Fixture refused");
    const data = browserSigningTypedData(original);
    validateSessionPayment(data, account.address, Math.floor(utc / 1000));
    validateSessionPayment(
      data,
      account.address,
      Math.floor((utc + 5000) / 1000)
    );
    if (utc + 5000 - Date.parse(original.admittedAt) > 300000)
      throw new Error("Fixture refused");
    life.live();
    status = "uncertain";
    const signature = await measuredAccount.signTypedData(data);
    life.live();
    const header = serializeBrowserSigningHeader(original, signature);
    callbackFetchStarts++;
    const response = await fetch(fixed.backend + "/fixture/callback", {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: life.abort.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: fixed.sessionId,
        requestId: fixed.requestId,
        header,
      }),
    });
    life.live();
    if (response.status !== 200) throw new Error("Fixture refused");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Fixture refused");
    let ack = "";
    let bytes = 0;
    try {
      while (true) {
        const part = await reader.read();
        life.live();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 512) throw new Error("Fixture refused");
        ack += new TextDecoder("utf-8", { fatal: true }).decode(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    life.live();
    if (
      ack ===
      JSON.stringify({
        version: "1",
        sessionId: fixed.sessionId,
        requestId: fixed.requestId,
        recorded: true,
      })
    )
      status = "recorded";
  } catch {
    // Deliberately no exception/provider data or signature in the status channel.
  } finally {
    life.close();
    busy = false;
    telemetry();
    postMessage({
      type: "status",
      correlationId: message.correlationId,
      status,
    });
  }
};
