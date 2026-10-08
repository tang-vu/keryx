/** Local stdio buyer: configured caller custody, deployment-pinned signing and retained recovery. */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createPublicClient, erc20Abi, formatUnits, parseUnits, type PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { assertCallerTransport, callerChain, callerProfile, callerConfig } from "./network-policy.mts";
import { attestedArcAuthorityHttp } from "../lib/arc-rpc-attestation.ts";
import { getGatewayAvailableAtomic } from "../lib/gateway/gateway-balance.ts";
import { loadPersistentTreasuryWallet } from "../lib/payments/persistent-treasury-wallet.ts";
import { GuardedArcSubmissionUnknownError } from "../lib/payments/guarded-arc-transaction.ts";
import { payForResearch, readPending, recoverResearch } from "./local-payment.mts";
import { ensureLocalFunding, readFunding, recoverFunding } from "./local-funding.mts";
import type { ReasoningSurface } from "../lib/llm/reasoning-telemetry.ts";
import { parseAskQuestion } from "../lib/ask-input.ts";

const RPC = callerConfig.rpcUrl;
const BASE_URL = (process.env.KERYX_BASE_URL ?? "https://keryx.cc").replace(/\/$/, "");
assertCallerTransport(BASE_URL);
const DEEP_FEE_USDC = Number(process.env.KERYX_A2A_DEEP_FEE ?? "0.05");
const DEFAULT_BUDGET_USDC = Number(process.env.KERYX_DEFAULT_BUDGET ?? "0.05");
const MAX_BUDGET_USDC = Number(process.env.KERYX_A2A_MAX_BUDGET ?? "0.5");
const MAX_TOTAL_USDC = Number(process.env.KERYX_MAX_TOTAL_USDC ?? "1");
const DEPOSIT_USDC = process.env.KERYX_GATEWAY_DEPOSIT ?? "0.5";
const PAYEE = process.env.KERYX_BUYER_PAYEE;
const walletDirectory = callerProfile.testnet ? path.join(os.homedir(), ".keryx") : path.join(os.homedir(), ".keryx", callerProfile.name);
const WALLET_FILE = process.env.KERYX_WALLET_FILE ?? path.join(walletDirectory, "buyer-wallet.json");
const JOURNAL_FILE = process.env.KERYX_PAYMENT_JOURNAL ?? path.join(path.dirname(WALLET_FILE), "buyer-payment.json");
const FUNDING_FILE = `${JOURNAL_FILE}.funding.json`;
const CUSTODY_GUIDANCE = "Configure KERYX_BUYER_PRIVATE_KEY or an existing valid KERYX_WALLET_FILE. No wallet is created or replaced. Preserve any old wallet and journals for owner recovery";
let cachedAccount: PrivateKeyAccount | undefined;

function configuredAccount(): PrivateKeyAccount {
  if (cachedAccount) return cachedAccount;
  try {
    const configured = process.env.KERYX_BUYER_PRIVATE_KEY;
    if (configured !== undefined && !/^0x[0-9a-f]{64}$/i.test(configured)) throw new Error();
    const key = (configured as `0x${string}` | undefined) ?? loadPersistentTreasuryWallet(WALLET_FILE).privateKey;
    cachedAccount = privateKeyToAccount(key);
    return cachedAccount;
  } catch { throw new Error(CUSTODY_GUIDANCE); }
}

export const meta = { address: "custody not loaded; run keryx_wallet_status", baseUrl: BASE_URL,
  network: callerProfile.networkId, networkLabel: callerProfile.label,
  feeUsdc: DEEP_FEE_USDC, defaultBudgetUsdc: DEFAULT_BUDGET_USDC, faucet: callerProfile.testnet ? "https://faucet.circle.com" : null,
  explorer: callerProfile.explorerUrl, walletFile: WALLET_FILE } as const;
export type WalletStatus = { address: string; gasBalance: string; usdcBalance: string;
  gatewayAvailable: string; ready: boolean; instructions: string };

function limits(budget = DEFAULT_BUDGET_USDC) {
  const micros = (value: number) => {
    const decimal = String(value);
    if (!Number.isFinite(value) || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(decimal) || value <= 0 || value > 1)
      throw new Error("Buyer budget and limits must be exact positive micro-USDC amounts, at most 1 USDC");
    return parseUnits(decimal, 6);
  };
  const creator = micros(budget), fee = micros(DEEP_FEE_USDC), maxBudget = micros(MAX_BUDGET_USDC), maxTotal = micros(MAX_TOTAL_USDC);
  if (creator > maxBudget || maxBudget > BigInt(500_000) || creator + fee > maxTotal
    || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(DEPOSIT_USDC)) throw new Error("Buyer budget or funding limits are invalid; maximum total is 1 USDC");
  const required = creator + fee, deposit = parseUnits(DEPOSIT_USDC, 6);
  if (deposit <= BigInt(0) || deposit > BigInt(1_000_000)) throw new Error("Deposit limit is at most 1 USDC");
  return { required, deposit };
}
function merchant() {
  if (!PAYEE || !/^0x[0-9a-f]{40}$/i.test(PAYEE) || /^0x0{40}$/i.test(PAYEE)) throw new Error("Set KERYX_BUYER_PAYEE to the independently reviewed seller payout address before purchasing");
  return PAYEE;
}

export async function getStatus(): Promise<WalletStatus> {
  let account: PrivateKeyAccount;
  try { account = configuredAccount(); }
  catch { return { address: "unconfigured", gasBalance: "unknown", usdcBalance: "unknown", gatewayAvailable: "unknown", ready: false, instructions: CUSTODY_GUIDANCE }; }
  try { merchant(); }
  catch { return { address: account.address, gasBalance: "unknown", usdcBalance: "unknown", gatewayAvailable: "unknown", ready: false,
    instructions: "Set KERYX_BUYER_PAYEE to the independently reviewed seller payout address before purchasing." }; }
  let required: bigint;
  try { ({ required } = limits()); }
  catch { return { address: account.address, gasBalance: "unknown", usdcBalance: "unknown", gatewayAvailable: "unknown", ready: false,
    instructions: "Buyer price/funding policy is invalid. Configure exact positive micro-USDC limits before purchasing." }; }
  if (fs.existsSync(`${JOURNAL_FILE}.lock`) || fs.existsSync(`${FUNDING_FILE}.lock`)) return { address: account.address,
    gasBalance: "unknown", usdcBalance: "unknown", gatewayAvailable: "unknown", ready: false,
    instructions: "Original payment or funding admission is held. Use keryx_recover; stop all buyers before owner inspection of any stale crash lock." };
  const pub = createPublicClient({ chain: callerChain, transport: attestedArcAuthorityHttp(RPC, { retryCount: 0, timeout: 4_000 }) });
  let gas: bigint, erc20: bigint, available: bigint | null;
  try {
    [gas, erc20, available] = await Promise.all([pub.getBalance({ address: account.address }),
      pub.readContract({ address: callerConfig.usdcAddress, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
      getGatewayAvailableAtomic(account.address)]);
  } catch { throw new Error(`${callerProfile.label} wallet balances unavailable; no funding or payment attempted`); }
  const pending = readPending(JOURNAL_FILE), funding = readFunding(FUNDING_FILE);
  const held = !!pending || funding?.status === "pending";
  const ready = available !== null && available >= required && !held;
  const instructions = pending ? `Payment ${pending.status}: query ${pending.queryId}. Use keryx_recover before another paid call.`
    : funding?.status === "pending" ? `Original ${funding.phase} funding ${funding.transactionHash ?? "has no retained hash"} needs keryx_recover or owner review; no new deposit permitted.`
    : available === null ? "Circle Gateway credit is unknown; no deposit authorized. Retry status without paying."
    : ready ? `Ready for the default ${DEEP_FEE_USDC + DEFAULT_BUDGET_USDC} USDC quote on ${meta.networkLabel}; actual body-dependent terms are checked before signing.`
    : `Fund your configured wallet ${account.address} on ${meta.networkLabel} (${meta.network}). ${meta.faucet ? `Testnet faucet: ${meta.faucet}.` : "Mainnet funds and native gas must be supplied by the owner."} ask_keryx can approve and deposit bounded existing caller funds once; interrupted funding requires recovery. No automatic faucet or treasury funding.`;
  return { address: account.address, gasBalance: formatUnits(gas, 18), usdcBalance: formatUnits(erc20, 6),
    gatewayAvailable: available === null ? "unknown" : formatUnits(available, 6), ready, instructions };
}

export type KeryxCitation = { source: string; reward: number; weight?: number };
export type KeryxAnswer = Partial<ReasoningSurface> & { answer: string; citations: KeryxCitation[]; creatorsPaid: number | null; totalToCreators: number; feePaid: number;
  researchExports?: { bibtex: { content: string; count: number; omitted: number }; ris: { content: string; count: number; omitted: number }; evidenceCsv: string };
  settlementId?: string; amountPaid?: string };

export async function askKeryx(question: string, budget?: number): Promise<KeryxAnswer> {
  if (fs.existsSync(`${JOURNAL_FILE}.lock`) || fs.existsSync(`${FUNDING_FILE}.lock`))
    throw new Error("Original payment or funding admission is held; recover and inspect the existing lock before any new funding");
  if (readPending(JOURNAL_FILE)) throw new Error("Previous payment requires recovery. Use keryx_recover before another paid call");
  if (readFunding(FUNDING_FILE)?.status === "pending")
    throw new Error("Original funding requires recovery; use keryx_recover before another deposit");
  if (question.trim().length < 3 || question.length > 8192) throw new Error("Research question is invalid");
  // The paid API validates this same canonical text. Refuse before loading custody
  // or entering funding; original payment/lock recovery above remains first.
  const parsedQuestion = parseAskQuestion(question);
  if (!parsedQuestion.success) throw new Error(parsedQuestion.error);
  const account = configuredAccount(), payee = merchant(), { required, deposit } = limits(budget);
  try {
    await ensureLocalFunding({ account, rpcUrl: RPC, file: FUNDING_FILE, required, deposit });
    const r = await payForResearch<KeryxAnswer>({ url: `${BASE_URL}/api/agent/ask`, account, journalFile: JOURNAL_FILE,
      rpcUrl: RPC, maxAmountUsdc: MAX_TOTAL_USDC, expectedPayee: payee, expectedAmountMicros: required.toString(), waitForCompletionMs: 90000,
      body: { question: parsedQuestion.question, budget: budget ?? DEFAULT_BUDGET_USDC, researchMode: "deep", responseMode: "async" } });
    return { ...r.data, settlementId: r.settlementId, amountPaid: r.amountPaid };
  } catch (error) {
    if (error instanceof GuardedArcSubmissionUnknownError) throw new Error(`Funding outcome unknown for original transaction ${error.transactionHash}. Use keryx_recover; do not deposit again`);
    throw error;
  }
}

export async function recoverKeryx() {
  if (readPending(JOURNAL_FILE)) return recoverResearch(BASE_URL, JOURNAL_FILE);
  return recoverFunding(FUNDING_FILE, RPC);
}
