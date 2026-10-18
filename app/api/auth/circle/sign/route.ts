import { z } from "zod";
import { getSession } from "@/lib/auth";
import { config } from "@/lib/config";
import { authJson } from "@/lib/auth-challenge";
import { circleUserTokenSchema, verifiedCircleWallet, circleRequest, guardCirclePost, readCircleBody, circleFailure } from "@/lib/circle-wallet-server";
import { CIRCLE_TRANSACTION_SIGNING_UNAVAILABLE } from "@/lib/circle-wallet-capabilities";
export const runtime = "nodejs";
const schema = z.object({ userToken: circleUserTokenSchema, idempotencyKey: z.string().uuid(),
  kind: z.enum(["message", "typedData", "transaction"]), payload: z.string().min(1).max(24_000) }).strict();
export async function POST(request: Request) {
  const denied = await guardCirclePost(request); if (denied) return denied;
  const session = await getSession(); if (!session) return authJson({ error: "Sign in before using the Google wallet" }, 401);
  const body = await readCircleBody(request, schema).catch(() => null);
  if (!body) return authJson({ error: "invalid signature request" }, 400);
  // A native ARC/ARC-TESTNET identity must never be passed to the generic EVM
  // raw-sign endpoint, even by an older browser or a direct caller.
  if (body.kind === "transaction") return authJson({ error: CIRCLE_TRANSACTION_SIGNING_UNAVAILABLE, code: 4200 }, 501);
  try {
    const wallet = await verifiedCircleWallet(body.userToken);
    if (!wallet || wallet.address.toLowerCase() !== session.address.toLowerCase()) return authJson({ error: "Google wallet differs from the signed-in account" }, 403);
    let payload: Record<string, unknown>;
    try {
      if (body.kind === "message") {
        if (!/^0x(?:[a-fA-F0-9]{2})+$/.test(body.payload)) throw new Error("Invalid message bytes");
        payload = { message: body.payload, encodedByHex: true };
      } else {
        const value = JSON.parse(body.payload);
        if (!value?.domain || BigInt(value.domain.chainId) !== BigInt(config.profile.chainId)
          || !value.types || typeof value.primaryType !== "string" || !value.message) throw new Error("Invalid typed data");
        payload = { data: body.payload };
      }
    } catch { return authJson({ error: "Signature request does not match the selected Arc network or bounded transaction" }, 400); }
    const data = await circleRequest(`user/sign/${body.kind === "typedData" ? "typedData" : body.kind}`, {
      userToken: body.userToken, body: { ...payload, walletId: wallet.id, idempotencyKey: body.idempotencyKey },
    });
    return authJson({ challengeId: z.string().uuid().parse(data.challengeId) });
  } catch (error) { return circleFailure(error); }
}
