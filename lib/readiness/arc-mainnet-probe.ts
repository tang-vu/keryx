import { createHash } from "node:crypto";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";

// Public reference pins only. Never consumed by application payment configuration.
export const ARC_MAINNET_REFERENCE = Object.freeze({
  chainId: ARC_MAINNET_PROFILE.chainIdHex, network: ARC_MAINNET_PROFILE.networkId, domain: ARC_MAINNET_PROFILE.cctpDomain,
  usdc: ARC_MAINNET_PROFILE.usdcAddress,
  wallet: ARC_MAINNET_PROFILE.gatewayWallet,
  minter: ARC_MAINNET_PROFILE.gatewayMinter,
  decimals: ARC_MAINNET_PROFILE.erc20Decimals,
});
export const PUBLIC_RPC_ENDPOINTS = Object.freeze([
  "https://rpc.mainnet.arc.io", "https://rpc.blockdaemon.mainnet.arc.io",
  "https://rpc.drpc.mainnet.arc.io", "https://rpc.quicknode.mainnet.arc.io",
]);
export const GATEWAY_INFO_ENDPOINT = "https://gateway-api.circle.com/v1/info";
export const PROBE_SOURCES = Object.freeze([
  "https://docs.arc.io/arc/references/connect-to-arc",
  "https://docs.arc.io/arc/references/contract-addresses",
  "https://developers.circle.com/gateway/references/contract-addresses",
  "https://developers.circle.com/gateway/references/supported-blockchains",
  "https://raw.githubusercontent.com/circlefin/skills/master/plugins/circle/skills/use-gateway/SKILL.md",
]);
export const READ_ONLY_RPC_METHODS = Object.freeze([
  "eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call",
]);
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("malformed_evidence");
  return value as JsonObject;
}
function requireEvidence(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason);
}
function addressMatches(value: unknown, expected: string) {
  return typeof value === "string" && value.toLowerCase() === expected.toLowerCase();
}
const HASH = /^0x[0-9a-fA-F]{64}$/;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 5_000;
type Fetch = typeof globalThis.fetch;

// No URL input, headers, credentials, retry, redirect, environment or wallet authority.
async function request(fetcher: Fetch, url: string, body?: string): Promise<unknown> {
  requireEvidence(PUBLIC_RPC_ENDPOINTS.includes(url) || url === GATEWAY_INFO_ENDPOINT, "endpoint_refused");
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await fetcher(url, { method: body ? "POST" : "GET", body,
        headers: body ? { "content-type": "application/json" } : undefined,
        redirect: "error", credentials: "omit", signal: controller.signal });
      requireEvidence(!response.redirected && response.status >= 200 && response.status < 300, "http_unavailable");
      requireEvidence(response.body, "malformed_evidence");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          requireEvidence(size <= MAX_BYTES, "response_too_large");
          chunks.push(part.value);
        }
      } finally { await reader.cancel().catch(() => undefined); }
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw new Error("malformed_evidence"); }
    })()]);
  } finally { if (timeout) clearTimeout(timeout); controller.abort(); }
}

export async function readOnlyRpc(fetcher: Fetch, endpoint: string, method: string, params: unknown[] = []) {
  requireEvidence(READ_ONLY_RPC_METHODS.includes(method), "rpc_method_refused");
  // Even eth_call is constrained to the single non-mutating decimals view.
  if (method === "eth_call") {
    const call = object(params[0]);
    requireEvidence(Object.keys(call).length === 2 && call.to === ARC_MAINNET_REFERENCE.usdc && call.data === "0x313ce567" &&
      typeof params[1] === "string" && QUANTITY.test(params[1]) && params.length === 2, "rpc_params_refused");
  }
  const response = object(await request(fetcher, endpoint, JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })));
  requireEvidence(response.jsonrpc === "2.0" && response.id === 1 && !("error" in response) && "result" in response, "malformed_rpc");
  return response.result;
}

function block(value: unknown, expectedNumber?: string) {
  const result = object(value);
  requireEvidence(typeof result.number === "string" && QUANTITY.test(result.number) && BigInt(result.number) > BigInt(0) &&
    typeof result.hash === "string" && HASH.test(result.hash) && typeof result.parentHash === "string" && HASH.test(result.parentHash) &&
    typeof result.timestamp === "string" && QUANTITY.test(result.timestamp) &&
    (!expectedNumber || result.number === expectedNumber), "malformed_block");
  return { number: result.number, hash: result.hash, parentHash: result.parentHash, timestamp: result.timestamp };
}

async function inspectRpc(fetcher: Fetch, endpoint: string) {
  requireEvidence(await readOnlyRpc(fetcher, endpoint, "eth_chainId") === ARC_MAINNET_REFERENCE.chainId, "wrong_chain");
  const head = block(await readOnlyRpc(fetcher, endpoint, "eth_getBlockByNumber", ["latest", false]));
  const contracts = [];
  for (const [name, address] of [["usdc", ARC_MAINNET_REFERENCE.usdc], ["wallet", ARC_MAINNET_REFERENCE.wallet], ["minter", ARC_MAINNET_REFERENCE.minter]]) {
    const code = await readOnlyRpc(fetcher, endpoint, "eth_getCode", [address, head.number]);
    requireEvidence(typeof code === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(code) && !/^0x(?:00)+$/.test(code), "missing_or_malformed_code");
    contracts.push({ name, address, bytes: (code.length - 2) / 2,
      sha256: createHash("sha256").update(Buffer.from(code.slice(2), "hex")).digest("hex") });
  }
  const decimals = await readOnlyRpc(fetcher, endpoint, "eth_call", [{ to: ARC_MAINNET_REFERENCE.usdc, data: "0x313ce567" }, head.number]);
  requireEvidence(typeof decimals === "string" && /^0x[0-9a-fA-F]{64}$/.test(decimals) && BigInt(decimals) === BigInt(6), "decimal_mismatch");
  const recheck = block(await readOnlyRpc(fetcher, endpoint, "eth_getBlockByNumber", [head.number, false]), head.number);
  requireEvidence(JSON.stringify(recheck) === JSON.stringify(head), "inconsistent_block");
  requireEvidence(await readOnlyRpc(fetcher, endpoint, "eth_chainId") === ARC_MAINNET_REFERENCE.chainId, "wrong_chain");
  return { chainId: ARC_MAINNET_REFERENCE.chainId, block: head, contracts, erc20Decimals: 6,
    authenticity: "presence_only_not_audited" as const };
}

export function inspectGatewayMetadata(value: unknown) {
  const info = object(value);
  requireEvidence(info.version === 1 && Array.isArray(info.domains), "malformed_gateway_metadata");
  const rows = info.domains.map(object).filter(row => row.chain === "Arc" || row.domain === 26);
  requireEvidence(rows.length === 1, "missing_or_duplicate_arc_metadata");
  const row = rows[0];
  requireEvidence(row.chain === "Arc" && row.network === "Mainnet" && row.domain === 26, "gateway_domain_mismatch");
  for (const [key, expected] of [["walletContract", ARC_MAINNET_REFERENCE.wallet], ["minterContract", ARC_MAINNET_REFERENCE.minter]]) {
    const contract = object(row[key]);
    requireEvidence(addressMatches(contract.address, expected) && Array.isArray(contract.supportedTokens) &&
      contract.supportedTokens.includes("USDC"), "gateway_contract_mismatch");
  }
  requireEvidence(typeof row.processedHeight === "string" && /^[1-9][0-9]*$/.test(row.processedHeight) &&
    typeof row.burnIntentExpirationHeight === "string" && /^[1-9][0-9]*$/.test(row.burnIntentExpirationHeight) &&
    BigInt(row.burnIntentExpirationHeight) > BigInt(row.processedHeight), "malformed_gateway_heights");
  return { version: 1, chain: "Arc", network: "Mainnet", domain: 26,
    wallet: ARC_MAINNET_REFERENCE.wallet, minter: ARC_MAINNET_REFERENCE.minter,
    processedHeight: row.processedHeight, burnIntentExpirationHeight: row.burnIntentExpirationHeight };
}

const SAFE_REASONS = new Set(["timeout", "http_unavailable", "response_too_large", "malformed_evidence", "malformed_rpc",
  "wrong_chain", "malformed_block", "missing_or_malformed_code", "decimal_mismatch", "inconsistent_block",
  "malformed_gateway_metadata", "missing_or_duplicate_arc_metadata", "gateway_domain_mismatch", "gateway_contract_mismatch", "malformed_gateway_heights"]);
async function capture<T>(operation: () => Promise<T>) {
  try { return { status: "observed" as const, evidence: await operation() }; }
  catch (error) { return { status: "unavailable" as const, reason: error instanceof Error && SAFE_REASONS.has(error.message) ? error.message : "request_unavailable" }; }
}

export async function probeArcMainnet(fetcher: Fetch = globalThis.fetch) {
  // Independent endpoints are inspected once each; a failing endpoint is never retried.
  const rpc = await Promise.all(PUBLIC_RPC_ENDPOINTS.map(async endpoint => ({ endpoint,
    ...await capture(() => inspectRpc(fetcher, endpoint)) })));
  const gateway = { endpoint: GATEWAY_INFO_ENDPOINT,
    ...await capture(async () => inspectGatewayMetadata(await request(fetcher, GATEWAY_INFO_ENDPOINT))) };
  const observed = rpc.filter(row => row.status === "observed");
  // Heads may differ; agreement is tested at the lowest observed pinned height.
  const consistency = await capture(async () => {
    requireEvidence(observed.length >= 2, "inconsistent_block");
    const number = observed.map(row => row.evidence!.block.number).reduce((a, b) => BigInt(a) < BigInt(b) ? a : b);
    const blocks = await Promise.all(observed.map(row => readOnlyRpc(fetcher, row.endpoint, "eth_getBlockByNumber", [number, false]).then(value => block(value, number))));
    requireEvidence(blocks.every(value => JSON.stringify(value) === JSON.stringify(blocks[0])), "inconsistent_block");
    return { ...blocks[0], agreeingEndpoints: observed.length };
  });
  return { schemaVersion: 1, observedAt: new Date().toISOString(), mode: "read_only", gate: "M1_PARTIAL", mainnetReady: false,
    sources: PROBE_SOURCES, reference: ARC_MAINNET_REFERENCE, rpc, gateway, consistency,
    externalEvidenceComplete: observed.length === PUBLIC_RPC_ENDPOINTS.length && gateway.status === "observed" && consistency.status === "observed",
    remainingGates: ["contract_authenticity_and_audit", "sdk_settlement_acceptance", "registry_authority", "signer_and_spend_isolation", "recovery_and_operations", "owner_go_no_go"] };
}
