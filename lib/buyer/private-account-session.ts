import { SiweMessage } from "siwe";
import { z } from "zod";
import { BUYER_ORIGIN, addressSchema } from "./protocol";
import { buyerFetch, type BuyerFetch } from "./transport";
import { readBoundedJson } from "../read-bounded-json";

type SignInAccount = { address: string; signMessage: (input: { message: string }) => Promise<string> };

/** Node-only temporary SIWE session. The signer signs a login message, never payment typed data.
 * Cookie stays in memory and the operation resolves only after confirmed sign-out. A lost login
 * response can leave an unknown server session until its short SIWE expiry; do not claim otherwise. */
export async function withPrivateBuyerSession<T>(account: SignInAccount, operation: (cookie: string) => Promise<T>,
  http: BuyerFetch = buyerFetch, now = Date.now()) {
  const address = addressSchema.parse(account.address);
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000 - 900000) throw new Error("Invalid private sign-in time");
  const sign = account.signMessage.bind(account);
  let cookie: string | undefined;
  try {
    const challenge = await http(`${BUYER_ORIGIN}/api/auth/nonce`, { method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30000) });
    if (challenge.status !== 200) { await challenge.body?.cancel(); throw new Error(); }
    const { nonce } = z.object({ nonce: z.string().regex(/^[a-zA-Z0-9]{8,64}$/) }).parse(await readBoundedJson(challenge, 4096));
    const message = new SiweMessage({ domain: "keryx.cc", address, statement: "Sign in to Keryx. Citations are currency.", uri: BUYER_ORIGIN,
      version: "1", chainId: 5042002, nonce, issuedAt: new Date(now).toISOString(), expirationTime: new Date(now+900000).toISOString() }).prepareMessage();
    const signature = await sign({ message });
    const auth = await http(`${BUYER_ORIGIN}/api/auth/verify`, { method: "POST", redirect: "error", cache: "no-store",
      headers: { origin: BUYER_ORIGIN, "content-type": "application/json", cookie: `siwe_nonce=${nonce}` },
      body: JSON.stringify({ message, signature }), signal: AbortSignal.timeout(30000) });
    const sessionCookies = auth.headers.getSetCookie().map(value => value.split(";")[0]).filter(value => value.startsWith("keryx_session="));
    if (sessionCookies.length === 1 && /^keryx_session=[A-Za-z0-9._-]+$/.test(sessionCookies[0]) && sessionCookies[0].length <= 8192) cookie = sessionCookies[0];
    await auth.body?.cancel();
    if (auth.status !== 200 || !cookie) throw new Error();
    return await operation(cookie);
  } catch { throw new Error("Private account operation unavailable"); }
  finally {
    if (cookie) {
      let revoked = false;
      // Revocation is idempotent; this is never a payment retry.
      for (let attempt=0; attempt<2 && !revoked; attempt++) {
        try {
          const response = await http(`${BUYER_ORIGIN}/api/auth/signout`, { method: "POST", redirect: "error", cache: "no-store",
            headers: { origin: BUYER_ORIGIN, cookie }, signal: AbortSignal.timeout(30000) });
          if (response.status !== 200) { await response.body?.cancel(); continue; }
          revoked = z.object({ ok: z.literal(true) }).safeParse(await readBoundedJson(response, 4096)).success;
        } catch { /* No response body, cookie or signature is exposed in diagnostics. */ }
      }
      if (!revoked) throw new Error("Private account session revocation could not be confirmed");
    }
  }
}
