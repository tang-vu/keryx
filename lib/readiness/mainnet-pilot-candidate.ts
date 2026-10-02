import { createHash } from "node:crypto";
import { posix, win32 } from "node:path";
import { z } from "zod";
import { ARC_MAINNET_REFERENCE, PUBLIC_RPC_ENDPOINTS } from "./arc-mainnet-probe";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(v => !/^0x0{40}$/i.test(v));
const micro = z.string().regex(/^[1-9][0-9]{0,6}$/);
const origin = z.string().max(256).refine(value => {
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password && u.origin === value; }
  catch { return false; }
});
const root = z.string().min(2).max(512).refine(value =>
  !/[\x00-\x1f]/.test(value) && !value.split(/[\\/]/).some(part => part === ".." || part === ".") &&
  (posix.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)));

/** Proposed limits only: parsing never grants permission to fund, sign or launch. */
export const mainnetPilotCandidateSchema = z.object({
  schema: z.literal("keryx-mainnet-pilot-candidate-v1"),
  releaseCommit: z.string().regex(/^[a-f0-9]{40}$/),
  deploymentId: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
  mainnetOrigin: origin, testnetOrigin: origin,
  mainnetStateRoot: root, testnetStateRoot: root,
  mainnetEnvironmentFile: root, testnetEnvironmentFile: root,
  invitedBuyerAddresses: z.array(address).min(1).max(5),
  creatorPayoutAddresses: z.array(address).min(1).max(5),
  retainedTestnetSignerAddresses: z.array(address).min(1).max(100),
  limits: z.object({ totalMicroUsdc: micro, perBuyerMicroUsdc: micro,
    perAskMicroUsdc: micro, perPaymentMicroUsdc: micro, maxAsks: z.number().int().min(1).max(20) }).strict(),
  rpcUrl: z.enum(PUBLIC_RPC_ENDPOINTS as unknown as [string, ...string[]]),
  registryAddress: address.nullable(),
  supportOwner: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{1,79}$/),
}).strict();
export type MainnetPilotCandidate = z.infer<typeof mainnetPilotCandidateSchema>;

function normalized(value: string): string {
  return (/^[A-Za-z]:/.test(value) ? win32.normalize(value) : posix.normalize(value))
    .replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}
function overlaps(a: string, b: string): boolean {
  const x = normalized(a), y = normalized(b);
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}
const unique = (values: string[]) => new Set(values.map(v => v.toLowerCase())).size === values.length;

export function inspectMainnetPilotCandidate(input: unknown) {
  const parsed = mainnetPilotCandidateSchema.safeParse(input);
  if (!parsed.success) return { schema: "keryx-mainnet-pilot-preflight-v1", candidateAccepted: false,
    mainnetReady: false, launchAuthorized: false, reasons: ["candidate_schema_refused"] } as const;
  const c = parsed.data, reasons: string[] = [];
  if (c.mainnetOrigin === c.testnetOrigin) reasons.push("origin_not_isolated");
  if (overlaps(c.mainnetStateRoot, c.testnetStateRoot) || overlaps(c.mainnetEnvironmentFile, c.testnetEnvironmentFile) ||
    overlaps(c.mainnetEnvironmentFile, c.testnetStateRoot) || overlaps(c.testnetEnvironmentFile, c.mainnetStateRoot))
    reasons.push("state_or_environment_not_isolated");
  const buyer = c.invitedBuyerAddresses.map(v => v.toLowerCase());
  const creators = c.creatorPayoutAddresses.map(v => v.toLowerCase());
  const testnet = new Set(c.retainedTestnetSignerAddresses.map(v => v.toLowerCase()));
  if (!unique(buyer) || !unique(creators) || !unique(c.retainedTestnetSignerAddresses)) reasons.push("duplicate_role_address");
  if ([...buyer, ...creators].some(v => testnet.has(v))) reasons.push("testnet_identity_reused");
  const n = Object.fromEntries(Object.entries(c.limits).filter(([k]) => k !== "maxAsks").map(([k, v]) => [k, BigInt(v)]));
  if (n.totalMicroUsdc > BigInt(1_000_000) || n.perBuyerMicroUsdc > BigInt(250_000) ||
    n.perAskMicroUsdc > BigInt(50_000) || n.perPaymentMicroUsdc > BigInt(10_000) ||
    n.perPaymentMicroUsdc > n.perAskMicroUsdc || n.perAskMicroUsdc > n.perBuyerMicroUsdc ||
    n.perBuyerMicroUsdc > n.totalMicroUsdc) reasons.push("pilot_limit_refused");
  // Canonical order is schema-owned, independent of input object key order.
  const candidateDigest = createHash("sha256").update(JSON.stringify(c)).digest("hex");
  return { schema: "keryx-mainnet-pilot-preflight-v1", candidateAccepted: reasons.length === 0,
    candidateDigest, releaseCommit: c.releaseCommit, mainnetReady: false, launchAuthorized: false, currentRuntimeSupported: false,
    reasons, profile: { ...ARC_MAINNET_REFERENCE, rpcUrl: c.rpcUrl,
      facilitatorUrl: "https://gateway-api.circle.com", explorerUrl: "https://explorer.arc.io" },
    scope: { candidate: "invited_caller_funded_research", invitedBuyers: buyer.length, creators: creators.length,
      selfFundedBuyerCreatorCount: buyer.filter(v => creators.includes(v)).length,
      limits: c.limits, allowedFutureSurfaces: ["web_browser"],
      excludedSpendSurfaces: ["caller_cli", "sponsored_web", "treasury", "a2a", "remote_mcp", "stdio_mcp", "openai_extension", "browser_extension", "bots", "desktop", "autonomous_workers"] },
    remainingGates: ["filesystem_identity_permissions_and_key_inventory", "shared_payment_profile_migration",
      ...(c.registryAddress === null ? ["mainnet_registry_deployment_and_creator_authority"] : ["mainnet_registry_identity_and_creator_authority"]),
      "durable_global_pilot_admission", "independent_security_review", "funded_settlement_and_response_loss_recovery",
      "creator_withdrawal", "isolated_deployment_restore_and_monitoring", "owner_funds_limits_and_go_no_go"] } as const;
}
