import { expect, it, vi } from "vitest";
import { SiweMessage } from "siwe";
import { withPrivateBuyerSession } from "./private-account-session";
import { AUTH_CHALLENGE_TTL_MS, WEB_SESSION_TTL_MS } from "../auth-time-policy";
const account = { address: `0x${"1".repeat(40)}`, signMessage: vi.fn(async (_input: { message: string }) => "synthetic-login-signature") };
const nonce = "syntheticNonce12345";
const issued = 1789012800000;
const challenge = { nonce, issuedAt: new Date(issued).toISOString(),
  challengeExpiresAt: new Date(issued + AUTH_CHALLENGE_TTL_MS).toISOString(), sessionExpiresAt: new Date(issued + WEB_SESSION_TTL_MS).toISOString() };
function server(signout: () => Response = () => Response.json({ ok: true })) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.redirect).toBe("error");
    if (url === "https://keryx.cc/api/auth/nonce") return Response.json(challenge);
    if (url === "https://keryx.cc/api/auth/verify") {
      expect(init?.headers).toMatchObject({ cookie: `siwe_nonce=${nonce}` });
      return Response.json({ ok: true }, { headers: { "set-cookie": "keryx_session=synthetic.session.cookie; HttpOnly; Secure" } });
    }
    expect(url).toBe("https://keryx.cc/api/auth/signout");
    expect(init?.headers).toMatchObject({ cookie: "keryx_session=synthetic.session.cookie" });
    return signout();
  });
}

it("signs a pinned short-lived SIWE login and revokes the session before returning operation data", async () => {
  account.signMessage.mockClear();
  const http = server();
  const operation = vi.fn(async (cookie: string) => { expect(cookie).toBe("keryx_session=synthetic.session.cookie"); return { recovered: true }; });
  expect(await withPrivateBuyerSession(account, operation, http)).toEqual({ recovered: true });
  expect(account.signMessage).toHaveBeenCalledTimes(1);
  const message = new SiweMessage(account.signMessage.mock.calls[0]?.[0]?.message);
  expect(message).toMatchObject({ domain: "keryx.cc", uri: "https://keryx.cc", chainId: 5042002, nonce, address: account.address });
  expect(Date.parse(message.expirationTime!) - Date.parse(message.issuedAt!)).toBe(900000);
  expect(message.issuedAt).toBe(challenge.issuedAt);
  expect(http).toHaveBeenCalledTimes(3);
});

it.each([-86400000, 86400000])("keeps private login server-dated with client skew %s", async skew => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(issued + skew);
  try {
    account.signMessage.mockClear();
    expect(await withPrivateBuyerSession(account, async () => true, server())).toBe(true);
    expect(new SiweMessage(account.signMessage.mock.calls[0][0].message).issuedAt).toBe(challenge.issuedAt);
  } finally { clock.mockRestore(); }
});

it("revokes after operation failure and refuses success when revocation remains unconfirmed", async () => {
  const http = server();
  await expect(withPrivateBuyerSession(account, async () => { throw new Error("synthetic-private-question"); }, http)).rejects.toThrow(/^Private account operation unavailable$/);
  expect(http).toHaveBeenCalledTimes(3);
  let attempts = 0;
  const retry = server(() => ++attempts === 1 ? new Response("private-error", { status: 503 }) : Response.json({ ok: true }));
  expect(await withPrivateBuyerSession(account, async () => true, retry)).toBe(true);
  expect(attempts).toBe(2);
  await expect(withPrivateBuyerSession(account, async () => true, server(() => new Response("private-error", { status: 503 })))).rejects.toThrow("revocation could not be confirmed");
});

it("rejects malformed challenges before asking for a signature", async () => {
  account.signMessage.mockClear();
  await expect(withPrivateBuyerSession(account, async () => true, async () => Response.json({ nonce: "invalid;cookie" }))).rejects.toThrow("operation unavailable");
  expect(account.signMessage).not.toHaveBeenCalled();
});
