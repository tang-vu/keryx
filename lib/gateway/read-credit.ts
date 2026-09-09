import { z } from "zod";
import { readBoundedJson } from "../read-bounded-json";
import { BUYER_NETWORK, addressSchema } from "../buyer/protocol";

const creditSchema = z.object({ status: z.literal("known"), address: addressSchema,
  network: z.literal(BUYER_NETWORK), available: z.string().regex(/^(0|[1-9]\d{0,77})$/) });

/** Browser-safe lookup for a specific EOA. Unknown funds must never prompt a deposit. */
export async function readGatewayCredit(address: string, signal?: AbortSignal): Promise<bigint> {
  addressSchema.parse(address);
  const timeout = AbortSignal.timeout(20_000);
  const response = await fetch(`/api/session/credit?address=${encodeURIComponent(address)}`, {
    headers: { accept: "application/json" }, credentials: "omit", redirect: "error", cache: "no-store",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error("Gateway balance is unavailable. Retry before adding funds."); }
  const parsed = creditSchema.safeParse(await readBoundedJson(response));
  if (!parsed.success || parsed.data.address.toLowerCase() !== address.toLowerCase()) throw new Error("Gateway balance could not be verified for this wallet.");
  return BigInt(parsed.data.available);
}
