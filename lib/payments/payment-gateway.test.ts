import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeryxDB } from "../db/keryx-db";

vi.mock("../config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config")>();
  return { config: { ...actual.config, funderKey: `0x${"11".repeat(32)}` } };
});

const { getGrant } = vi.hoisted(() => ({ getGrant: vi.fn() }));
vi.mock("./session-grants", () => ({ getGrant }));

import { getPaymentGateway } from "./payment-gateway";

const db = {} as KeryxDB;
const signer = "0x1111111111111111111111111111111111111111";

describe("payment gateway browser authority", () => {
  beforeEach(() => {
    getGrant.mockReset();
  });

  it("fails closed when an admitted browser grant disappears before gateway creation", async () => {
    getGrant.mockResolvedValue(undefined);
    await expect(getPaymentGateway(db, { sessionId: "owner", requestSignature: vi.fn() }))
      .rejects.toThrow(/grant expired or revoked/);
  });

  it("requires a signature callback for a browser session", async () => {
    await expect(getPaymentGateway(db, { sessionId: "owner" }))
      .rejects.toThrow(/signature callback/);
    expect(getGrant).not.toHaveBeenCalled();
  });

  it("rejects a signature callback without a session instead of selecting treasury", async () => {
    await expect(getPaymentGateway(db, { requestSignature: vi.fn() }))
      .rejects.toThrow(/requires a session id/);
    expect(getGrant).not.toHaveBeenCalled();
  });

  it("constructs the browser gateway with the captured session signer", async () => {
    getGrant.mockResolvedValue({ sessAddr: signer, grantEpoch: "epoch-current" });
    const gateway = await getPaymentGateway(db, { sessionId: "owner", requestSignature: vi.fn() });
    expect(gateway.mode).toBe("real");
    expect(gateway.agentAddress()).toBe(signer);
  });
});
