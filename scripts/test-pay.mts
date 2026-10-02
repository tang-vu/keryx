/**
 * test-pay — isolated diagnostic for the real x402 settlement path.
 * Reuses a persistent test wallet (data/test-wallet.json, gitignored) so we don't re-fund each run.
 * Requires an existing owner-provisioned wallet; never creates or replaces custody state.
 * Funds + deposits if the Gateway balance is low, prints observed balances, then pays one
 * source endpoint and prints the result or the detailed error.
 *
 * Usage: node --import tsx --env-file-if-exists=.env.local scripts/test-pay.mts [sourceId]
 */

import path from "node:path";
import { createPublicClient, encodeFunctionData, erc20Abi, formatUnits, parseEther, parseUnits } from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../lib/config.ts";
import { assertArcRpcChain, attestedArcHttp } from "../lib/arc-rpc-attestation.ts";
import { getDb } from "../lib/db/index.ts";
import { ARC_GATEWAY_DEPOSIT_ABI, GuardedArcSubmissionUnknownError, sendGuardedArcTransaction } from "../lib/payments/guarded-arc-transaction.ts";
import { getGatewayAvailableAtomic } from "../lib/gateway/gateway-balance.ts";
import { payWithServerSigner } from "../lib/payments/server-x402-client.ts";
import { sourceFetchPayTo } from "../lib/registry/source-fetch-payto.ts";
import { createPinnedArcBatchSigner } from "../lib/payments/pinned-arc-batch-signer.ts";
import { loadPersistentTreasuryWallet } from "../lib/payments/persistent-treasury-wallet.ts";

async function main() {
  const STORE = path.resolve(process.cwd(), "data", "test-wallet.json");
  const acct = privateKeyToAccount(loadPersistentTreasuryWallet(STORE).privateKey);
  const db = await getDb();
  const sources = await db.listSources();
  const sid = process.argv[2] ?? sources[0]?.id;
  const source = sources.find((candidate) => candidate.id === sid);
  if (!source) throw new Error("Requested source is not registered; no funding started");
  const expectedPayee = await sourceFetchPayTo(source);
  console.log("test wallet:", acct.address);

  const gatewaySigner = createPinnedArcBatchSigner(acct, config.rpcUrl);
  const funder = (() => {
    try { return privateKeyToAccount(config.funderKey as `0x${string}`); }
    catch { throw new Error("Funder key unavailable; owner configuration recovery required"); }
  })();
  const pub = createPublicClient({ chain: arcTestnet, transport: attestedArcHttp(config.rpcUrl) });
  async function confirmed(hash: `0x${string}`) {
    let receipt;
    try { receipt = await pub.waitForTransactionReceipt({ hash }); }
    catch { throw new GuardedArcSubmissionUnknownError(hash); }
    if (typeof receipt.transactionHash !== "string" || receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) throw new GuardedArcSubmissionUnknownError(hash);
    if (receipt.status === "reverted") throw new Error(`Transaction reverted (${hash}); inspect the original hash before any manual retry.`);
    if (receipt.status !== "success") throw new GuardedArcSubmissionUnknownError(hash);
  }

  async function balances() {
    const available = await getGatewayAvailableAtomic(acct.address);
    if (available === null) throw new Error("Gateway balance unavailable");
    const wallet = await pub.readContract({ address: config.usdcAddress, abi: erc20Abi,
      functionName: "balanceOf", args: [acct.address] });
    return { available, wallet };
  }
  const fmt = (b: Awaited<ReturnType<typeof balances>>) =>
    `wallet=${formatUnits(b.wallet, 6)} | gw.available=${formatUnits(b.available, 6)}`;

  let bal = await balances();
  console.log("before:", fmt(bal));

  if (bal.available < parseUnits("0.5", 6)) {
    console.log("funding + depositing 1 USDC…");
    const gtx = await sendGuardedArcTransaction({ account: funder, rpcUrl: config.rpcUrl,
      transaction: { to: acct.address, value: parseEther("0.05") } });
    await confirmed(gtx);
    const amount = parseUnits("1", 6);
    const utx = await sendGuardedArcTransaction({ account: funder, rpcUrl: config.rpcUrl,
      transaction: { to: config.usdcAddress, data: encodeFunctionData({ abi: erc20Abi,
        functionName: "transfer", args: [acct.address, amount] }) } });
    await confirmed(utx);
    const allowance = await pub.readContract({ address: config.usdcAddress, abi: erc20Abi,
      functionName: "allowance", args: [acct.address, config.gatewayWallet] });
    if (allowance < amount) {
      const approval = await sendGuardedArcTransaction({ account: acct, rpcUrl: config.rpcUrl,
        transaction: { to: config.usdcAddress, data: encodeFunctionData({ abi: erc20Abi,
          functionName: "approve", args: [config.gatewayWallet, amount] }) } });
      await confirmed(approval);
    }
    const deposit = await sendGuardedArcTransaction({ account: acct, rpcUrl: config.rpcUrl,
      transaction: { to: config.gatewayWallet, gas: BigInt(120000), data: encodeFunctionData({ abi: ARC_GATEWAY_DEPOSIT_ABI,
        functionName: "deposit", args: [config.usdcAddress, amount] }) } });
    await confirmed(deposit);
    console.log("deposit tx:", deposit);
    for (let i = 0; i < 30; i++) {
      bal = await balances();
      console.log(`  poll ${i}: ${fmt(bal)}`);
      if (bal.available >= parseUnits("1", 6)) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (bal.available < amount) throw new Error(`Gateway credit not observed for deposit (${deposit}); inspect the original hash before any manual retry.`);
  }

  const url = `${config.baseUrl}/api/source/${sid}`;
  console.log("paying:", url, "| maxTimeoutSeconds:", config.maxTimeoutSeconds);
  try {
    await assertArcRpcChain(config.rpcUrl);
    const r = await payWithServerSigner<{ content?: string }>({ url, method: "GET",
      expectedPayee, expectedAmount: source.fetchPrice,
      payer: acct.address, signer: gatewaySigner });
    console.log("payment result:", { amount: r.amountUsdc, tx: r.transaction,
      status: r.settlementStatus, delivered: r.delivered });
  } catch {
    console.error("Payment diagnostic challenge/signing failed; inspect the source configuration before retrying.");
    process.exitCode = 1;
  }
  console.log("after:", fmt(await balances()));
}
await main().catch((error: unknown) => {
  console.error(error instanceof GuardedArcSubmissionUnknownError
    ? `Transaction outcome unknown (${error.transactionHash}); inspect the original hash before any manual retry.`
    : error instanceof Error ? error.message : "Payment diagnostic failed");
  process.exitCode = 1;
});
