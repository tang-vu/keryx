import { mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { acceptPrivateQuote } from "./private-quote";
import { privateMerchantPolicySchema, type PrivateMerchantPolicy } from "./private-merchant-policy";
import { addressSchema, buyerTypedData } from "./protocol";
import { createPrivateAuthorization, PRIVATE_RESEARCH_RESOURCE } from "./private-request-commitment";
import { preparePrivateResearchIntent } from "../a2a/private-research-intent";
import { validatePrivateBuyerIntent } from "./private-journal";
import { writeBuyerFile } from "./journal";

/** Node-only preparation for a fresh job. No HTTP, funding or submission occurs.
 * The directory remains reserved on every failure after creation, including signing
 * or fsync failures. Recovery must not call this function or refresh an authorization. */
export async function preparePrivateBuyerJournal(directory: string, quoteValue: unknown,
  expectedRequest: unknown, merchantValue: PrivateMerchantPolicy,
  limits: { maxTotalMicros: string; maxServiceFeeMicros: string },
  account: { address: string; signTypedData: (data: ReturnType<typeof buyerTypedData>) => Promise<`0x${string}`> },
  now = Date.now()) {
  try {
    const merchants = privateMerchantPolicySchema.parse(merchantValue);
    const quote = acceptPrivateQuote(quoteValue, expectedRequest, merchants, limits);
    const owner = addressSchema.parse(account.address).toLowerCase();
    const sign = account.signTypedData.bind(account);
    const absolute = resolve(directory);
    await mkdir(absolute, { mode: 0o700 });
    if (process.platform !== "win32") {
      const parent = await open(dirname(absolute), "r");
      try { await parent.sync(); } finally { await parent.close(); }
    }
    const fresh = await createPrivateAuthorization(quote.request, quote.requirement, owner, merchants, now);
    const signature = await sign(buyerTypedData(fresh.authorization));
    const submission = { request: fresh.request, salt: fresh.salt, payment: { authorization: fresh.authorization, signature } };
    const prepared = await preparePrivateResearchIntent(submission, quote.requirement, merchants);
    const intent = await validatePrivateBuyerIntent({ schema: "keryx-private-buyer-intent-v1",
      resource: PRIVATE_RESEARCH_RESOURCE, id: prepared.id, requirement: quote.requirement, submission }, owner, merchants);
    // Preserve compatibility with the bounded journal reader, including JSON indentation.
    if (Buffer.byteLength(JSON.stringify(intent, null, 2) + "\n", "utf8") > 65536) throw new Error();
    await writeBuyerFile(absolute, "private-intent.json", intent);
    return { directory: absolute, id: intent.id };
  } catch {
    throw new Error("Private buyer preparation failed. Keep any created journal directory; do not submit or regenerate its authorization.");
  }
}
