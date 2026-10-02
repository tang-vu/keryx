import { expect, it } from "vitest";
import { revokeBrowserSessionGrant } from "./browser-session-revocation";

const original = { sessionId: `0x${"11".repeat(20)}`, sessAddr: `0x${"22".repeat(20)}`, grantEpoch: "00000000-0000-4000-8000-000000000001" };
it("sends the request-init grant tuple even if local renewal changes it during HTTP", async () => {
  const input = { ...original }; let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let sent: unknown;
  const result = revokeBrowserSessionGrant(input, async (_url, options) => {
    sent = JSON.parse(options!.body as string); await delayed;
    return Response.json({ ok: true, sessAddr: original.sessAddr, spent: 0.1, residualUsdc: 0.2 });
  });
  input.grantEpoch = "00000000-0000-4000-8000-000000000002"; input.sessAddr = original.sessionId;
  release(); await result;
  expect(sent).toEqual(original);
});
it("refuses HTTP success without an exact bounded revocation acknowledgement", async () => {
  for (const ack of [{ ok: false }, { ok: true, sessAddr: original.sessionId, spent: 0, residualUsdc: 1 },
    { ok: true, sessAddr: original.sessAddr, spent: 0, residualUsdc: -1 }]) {
    await expect(revokeBrowserSessionGrant(original, async () => Response.json(ack))).rejects.toThrow();
  }
  await expect(revokeBrowserSessionGrant(original, async () => Response.json({ ok: true }, { status: 409 }))).rejects.toThrow("not confirmed");
});
