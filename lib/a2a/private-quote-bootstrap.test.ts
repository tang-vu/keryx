import { afterEach, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { KeryxDB } from "../db/keryx-db";
const state = vi.hoisted(() => ({ config: { funderKey: "", networkId: "eip155:5042002", sellerAddress: `0x${"1".repeat(40)}`,
  privateResearchReservedPayees: `0x${"4".repeat(40)}` } }));
vi.mock("../config", () => state);
import { privateQuoteBootstrap } from "./private-quote-bootstrap";
afterEach(() => vi.unstubAllEnvs());

it("is off by default and derives configured signer identities without exposing payment operations", () => {
  vi.stubEnv("KERYX_PRIVATE_RESEARCH_ENABLED", "0");
  const db = {} as KeryxDB;
  expect(privateQuoteBootstrap(db)).toBeNull();
  // Ephemeral, unfunded keys; no persisted wallet or signing request.
  const privateKey = generatePrivateKey(); state.config.funderKey = generatePrivateKey();
  const env = { KERYX_PRIVATE_RESEARCH_ENABLED: "1", KERYX_PRIVATE_TREASURY_PRIVATE_KEY: privateKey,
    KERYX_PRIVATE_TREASURY_ADDRESS: privateKeyToAccount(privateKey).address, KERYX_PRIVATE_RESEARCH_PAYEE: state.config.privateResearchReservedPayees,
    KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES: state.config.privateResearchReservedPayees, KERYX_PRIVATE_TREASURY_CAPACITY_MICROS: "50000",
    KERYX_PRIVATE_SERVICE_FEE_MICROS: "20000", KERYX_PRIVATE_MODEL_ID: "deepseek-flash", KERYX_PRIVATE_PROVIDER: "deepseek",
    KERYX_PRIVATE_PROVIDER_BASE_URL: "https://synthetic.example/v1", KERYX_PRIVATE_PROVIDER_API_KEY: "synthetic-secret",
    KERYX_PRIVATE_APPROVED_ENDPOINTS: '["https://synthetic.example/v1/chat/completions"]' };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const bootstrap = privateQuoteBootstrap(db)!;
  expect(Object.keys(bootstrap)).toEqual(["quote"]);
  const quote = bootstrap.quote({ question: "Synthetic quote question", budget: 0.03, researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" });
  expect(quote.requirement.amount).toBe("50000");
  expect(JSON.stringify(quote)).not.toContain(privateKey);
  expect(JSON.stringify(quote)).not.toContain("synthetic-secret");
  vi.stubEnv("KERYX_PRIVATE_TREASURY_PRIVATE_KEY", "synthetic-secret-invalid-key");
  expect(() => privateQuoteBootstrap(db)).toThrow(/^Private quote configuration unavailable$/);
});
