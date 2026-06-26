/**
 * Code-golf: smallest x402 paying agent (~20 lines)
 *
 * An AI agent that pays real USDC on-chain to read content, in under 20 lines.
 * Uses Circle Gateway for batched settlement on Arc testnet.
 *
 * Usage: npx tsx scripts/code-golf-agent.mts <url>
 * Example: npx tsx scripts/code-golf-agent.mts https://keryx.cc/api/agent/ask
 *
 * Requires: KERYX_BUYER_PRIVATE_KEY env or ~/.keryx/buyer-wallet.json
 */

import { GatewayClient } from "@circle-fin/x402-batching/client";
import { generatePrivateKey } from "viem/accounts";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";

const wf = path.join(os.homedir(), ".keryx", "buyer-wallet.json");
const pk = (process.env.KERYX_BUYER_PRIVATE_KEY ??
  (() => { try { return JSON.parse(fs.readFileSync(wf, "utf8")).privateKey } catch {
    const k = generatePrivateKey(); fs.mkdirSync(path.dirname(wf), {recursive: true});
    fs.writeFileSync(wf, JSON.stringify({privateKey: k})); return k;
  }})()) as `0x${string}`;

const gw = new GatewayClient({ chain: "arcTestnet", privateKey: pk });
const r = await gw.pay(process.argv[2] ?? "https://keryx.cc/api/premium/quote", { method: "GET" });
console.log(`Paid $${r.formattedAmount} on ${r.network} — tx: ${r.transaction}`);
console.log(JSON.stringify(r.data, null, 2));
