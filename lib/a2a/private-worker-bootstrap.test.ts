import { afterEach, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyTypedData } from "viem";
import type { KeryxDB } from "../db/keryx-db";
import { authorizationSchema, buyerTypedData, BUYER_NETWORK, BUYER_USDC, BUYER_GATEWAY } from "../buyer/protocol";
const state = vi.hoisted(() => ({ config: { funderKey: "", networkId: "eip155:5042002", cctpDomain: 26,
  sellerAddress: `0x${"1".repeat(40)}`, privateResearchReservedPayees: `0x${"4".repeat(40)}` }, worker: vi.fn(), balance: vi.fn() }));
vi.mock("../config", () => ({ config: state.config }));
vi.mock("./private-worker", () => ({ createPrivateWorker: state.worker }));
vi.mock("../gateway/gateway-balance", () => ({ getGatewayAvailableAtomic: state.balance }));
import { privateWorkerBootstrap } from "./private-worker-bootstrap";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); state.config.cctpDomain = 26; });

it("is disabled without configuration and binds the real batching signer to the explicit private EOA", async () => {
  vi.stubEnv("KERYX_PRIVATE_WORKER_ENABLED", "0");
  expect(privateWorkerBootstrap({} as KeryxDB)).toBeNull();
  expect(state.worker).not.toHaveBeenCalled();
  const privateKey = generatePrivateKey(), account = privateKeyToAccount(privateKey);
  state.config.funderKey = generatePrivateKey();
  const env = { KERYX_PRIVATE_WORKER_ENABLED: "1", KERYX_PRIVATE_RESEARCH_ENABLED: "1",
    KERYX_PRIVATE_TREASURY_PRIVATE_KEY: privateKey, KERYX_PRIVATE_TREASURY_ADDRESS: account.address,
    KERYX_PRIVATE_RESEARCH_PAYEE: state.config.privateResearchReservedPayees,
    KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES: state.config.privateResearchReservedPayees,
    KERYX_PRIVATE_TREASURY_CAPACITY_MICROS: "50000", KERYX_PRIVATE_SERVICE_FEE_MICROS: "20000",
    KERYX_PRIVATE_MODEL_ID: "deepseek-flash", KERYX_PRIVATE_PROVIDER: "deepseek",
    KERYX_PRIVATE_PROVIDER_BASE_URL: "https://synthetic.example/v1", KERYX_PRIVATE_PROVIDER_API_KEY: "synthetic-secret",
    KERYX_PRIVATE_APPROVED_ENDPOINTS: '["https://synthetic.example/v1/chat/completions"]' };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const spool = { save: vi.fn(), read: vi.fn(), restore: vi.fn(), entries: vi.fn() };
  expect(() => privateWorkerBootstrap({} as KeryxDB)).toThrow("configuration unavailable");
  expect(state.worker).not.toHaveBeenCalled();
  const worker = { tick: vi.fn() }; state.worker.mockReturnValue(worker);
  const bootstrapped = privateWorkerBootstrap({} as KeryxDB, spool);
  expect(bootstrapped?.tick).toBe(worker.tick);
  expect(bootstrapped?.configurationId).toMatch(/^[a-f0-9]{64}$/);
  expect(state.balance).not.toHaveBeenCalled();
  expect(worker.tick).not.toHaveBeenCalled();
  const options = state.worker.mock.calls[0][1];
  expect(options.resultSpool).toBe(spool);
  expect(options.signerAddress).toBe(account.address);
  const signed = await options.signer.createPaymentPayload(2, { scheme: "exact", network: BUYER_NETWORK,
    asset: BUYER_USDC, amount: "1000", payTo: `0x${"5".repeat(40)}`, maxTimeoutSeconds: 604860,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } });
  const authorization = authorizationSchema.parse(signed.payload.authorization);
  expect(authorization.from.toLowerCase()).toBe(account.address.toLowerCase());
  expect(await verifyTypedData({ ...buyerTypedData(authorization), address: account.address, signature: signed.payload.signature })).toBe(true);
  state.balance.mockResolvedValueOnce(BigInt(0)).mockResolvedValueOnce(null);
  expect(await options.getGatewayBalance()).toBe(BigInt(0));
  expect(state.balance).toHaveBeenCalledWith(account.address);
  await expect(options.getGatewayBalance()).rejects.toThrow("balance unavailable");
  state.config.cctpDomain = 0;
  await expect(options.getGatewayBalance()).rejects.toThrow("network unavailable");
  expect(() => privateWorkerBootstrap({} as KeryxDB, spool)).toThrow("configuration unavailable");
  state.config.cctpDomain = 26;
  vi.stubEnv("KERYX_PRIVATE_TREASURY_PRIVATE_KEY", state.config.funderKey);
  vi.stubEnv("KERYX_PRIVATE_TREASURY_ADDRESS", privateKeyToAccount(state.config.funderKey as `0x${string}`).address);
  expect(() => privateWorkerBootstrap({} as KeryxDB, spool)).toThrow("configuration unavailable");
});
