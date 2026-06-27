/**
 * web-client — a HEADLESS browser simulator for Keryx's non-custodial web flow.
 *
 * Reproduces exactly what a real human does on keryx.cc, with no browser:
 *   1. Generate (or reuse) an asker wallet.
 *   2. SIWE sign-in  → keryx_session cookie.
 *   3. Claim the testnet USDC faucet (1 USDC, once per address).
 *   4. Derive the in-browser session key (keccak256 of a fixed-message signature).
 *   5. Fund the session EOA + deposit into Circle's Gateway.
 *   6. Register a session grant (recover mode — same path the browser uses).
 *   7. Ask Keryx a question and CO-SIGN each x402 toll with the session key.
 *
 * Every citation payout it triggers settles for real on Arc testnet. Because this is Keryx's
 * own headless driver (not a real visitor), it passes the bot key so the run is tagged
 * origin=engine (self-volume) — keeping the dashboard's external bucket for genuine third
 * parties. The private session key never leaves this process — identical trust model to the
 * real browser tab.
 *
 * One faucet-funded wallet is REUSED across runs (its grant is recovered from the live
 * Gateway balance each time) and only ROTATED to a fresh faucet-funded wallet once its
 * funds are exhausted — so a daily cron costs ~1 USDC per several weeks, not per run.
 *
 * Usage: npm run web -- "question" [budget]
 */

import fs from "node:fs";
import path from "node:path";
import { GatewayClient, type SupportedChainName } from "@circle-fin/x402-batching/client";
import { createPublicClient, createWalletClient, http, parseEther, keccak256 } from "viem";
import { arcTestnet } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SiweMessage } from "siwe";
import { config } from "../lib/config.ts";
import { signPaymentAuthorization, type PaymentRequirementsInput } from "../lib/x402-client-sign.ts";

// ── Tunables ──────────────────────────────────────────────────────────────────
const SESSION_CAP_USDC = 0.85;      // how much of the 1-USDC faucet drip to lock into a session
const SESSION_GAS_BUFFER = 0.01;    // extra native sent to the session EOA for its approve+deposit gas
const MIN_RESIDUAL_USDC = 0.05;     // below this Gateway residual we must (re)fund or rotate the wallet
const STATE = path.resolve(process.cwd(), "data", "web-client-state.json");

const question = process.argv[2] ?? "How do AI agents pay creators per citation with stablecoins?";
const budget = process.argv[3] ? parseFloat(process.argv[3]) : 0.05;
const base = config.baseUrl.replace(/\/$/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fixed message — MUST byte-match use-session-grant.ts DERIVE_MESSAGE or the derived
// session key (and thus the funded Gateway balance) would differ and be unrecoverable.
const DERIVE_MESSAGE =
  "Keryx spending session key v1\n\n" +
  "Sign to derive your in-browser spending session. This is NOT a transaction and " +
  "costs no gas. Signing the same message always recreates the same session, so your " +
  "funds are never lost. Only sign this on keryx.cc.";

// ── Tiny cookie jar (Node fetch does not persist cookies) ───────────────────────
const jar = new Map<string, string>();
function capture(res: Response) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

// ── Persistent active asker wallet (reused until exhausted, then rotated) ───────
function loadActiveKey(): `0x${string}` {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8")).privateKey;
  } catch {
    const key = generatePrivateKey();
    saveActiveKey(key);
    return key;
  }
}
function saveActiveKey(key: `0x${string}`) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ privateKey: key, address: privateKeyToAccount(key).address, rotatedAt: new Date().toISOString() }, null, 2));
}

const pub = createPublicClient({ chain: arcTestnet, transport: http(config.rpcUrl) });

// ── SIWE sign-in for the asker wallet → keryx_session cookie ────────────────────
async function siweLogin(askerKey: `0x${string}`) {
  const asker = privateKeyToAccount(askerKey);
  const wallet = createWalletClient({ account: asker, chain: arcTestnet, transport: http(config.rpcUrl) });
  const nonceRes = await fetch(`${base}/api/auth/nonce`);
  capture(nonceRes);
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  const host = new URL(base).host;
  const message = new SiweMessage({
    domain: host,
    address: asker.address,
    statement: "Sign in to Keryx.",
    uri: base,
    version: "1",
    chainId: arcTestnet.id,
    nonce,
  }).prepareMessage();
  const signature = await wallet.signMessage({ account: asker, message });
  const verifyRes = await fetch(`${base}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader() },
    body: JSON.stringify({ message, signature }),
  });
  capture(verifyRes);
  if (!verifyRes.ok) throw new Error(`SIWE verify failed: ${verifyRes.status} ${await verifyRes.text()}`);
}

/** Claim the faucet for the signed-in asker. Returns false if already claimed. */
async function claimFaucet(): Promise<boolean> {
  const res = await fetch(`${base}/api/faucet`, { method: "POST", headers: { Cookie: cookieHeader() } });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; tx?: string; error?: string };
  if (res.ok && data.ok) {
    console.log(`   faucet dripped 1 USDC (tx ${String(data.tx).slice(0, 12)}…)`);
    return true;
  }
  console.log(`   faucet: ${data.error ?? res.status} (reusing existing balance)`);
  return false;
}

// ── Main ────────────────────────────────────────────────────────────────────────
let askerKey = loadActiveKey();

async function ensureFundedSession(): Promise<{ sessionId: string; sessAddr: string; cap: number; sessKey: `0x${string}` }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const asker = privateKeyToAccount(askerKey);
    const askerWallet = createWalletClient({ account: asker, chain: arcTestnet, transport: http(config.rpcUrl) });
    await siweLogin(askerKey);

    // Derive the deterministic session key + its Gateway client.
    const sessSig = await askerWallet.signMessage({ account: asker, message: DERIVE_MESSAGE });
    const sessKey = keccak256(sessSig);
    const sessAddr = privateKeyToAccount(sessKey).address;
    const gw = new GatewayClient({ chain: config.network as SupportedChainName, privateKey: sessKey, rpcUrl: config.rpcUrl });

    let residual = Number((await gw.getBalances()).gateway.available) / 1e6;
    console.log(`   asker ${asker.address}\n   session ${sessAddr} · Gateway residual ${residual.toFixed(6)} USDC`);

    if (residual < MIN_RESIDUAL_USDC) {
      // Need to fund. Make sure the asker holds enough native USDC; claim faucet if not.
      let askerBal = Number(await pub.getBalance({ address: asker.address })) / 1e18;
      if (askerBal < SESSION_CAP_USDC + SESSION_GAS_BUFFER + 0.02) {
        const claimed = await claimFaucet();
        if (claimed) {
          for (let i = 0; i < 20 && askerBal < SESSION_CAP_USDC; i++) {
            await sleep(2500);
            askerBal = Number(await pub.getBalance({ address: asker.address })) / 1e18;
          }
        }
      }
      if (askerBal < SESSION_CAP_USDC + SESSION_GAS_BUFFER) {
        // This wallet is exhausted (faucet already claimed, balance spent) → rotate to a fresh one.
        console.log(`   wallet exhausted (bal ${askerBal.toFixed(4)}) — rotating to a fresh faucet wallet`);
        askerKey = generatePrivateKey();
        saveActiveKey(askerKey);
        continue;
      }

      // Fund the session EOA, then deposit into the Gateway from the session key.
      console.log(`   funding session EOA with ${(SESSION_CAP_USDC + SESSION_GAS_BUFFER).toFixed(4)} USDC…`);
      const fundTx = await askerWallet.sendTransaction({ to: sessAddr, value: parseEther((SESSION_CAP_USDC + SESSION_GAS_BUFFER).toFixed(18)), gas: 21000n });
      await pub.waitForTransactionReceipt({ hash: fundTx });
      await gw.deposit(SESSION_CAP_USDC.toString());
      for (let i = 0; i < 30; i++) {
        residual = Number((await gw.getBalances()).gateway.available) / 1e6;
        if (residual >= SESSION_CAP_USDC * 0.9) break;
        await sleep(3000);
      }
      console.log(`   Gateway credited: ${residual.toFixed(6)} USDC`);
    }

    if (residual < MIN_RESIDUAL_USDC) throw new Error("session funding did not credit in time");

    // Register the grant in recover mode (cap = live Gateway residual) — same as the browser.
    const grantRes = await fetch(`${base}/api/session/grant`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader() },
      body: JSON.stringify({ sessAddr, budget: residual, recover: true }),
    });
    if (!grantRes.ok) throw new Error(`grant registration failed: ${grantRes.status} ${await grantRes.text()}`);
    const { sessionId } = (await grantRes.json()) as { sessionId: string };
    return { sessionId, sessAddr, cap: residual, sessKey };
  }
  throw new Error("could not establish a funded session after rotation");
}

/** Stream POST /api/ask and co-sign each toll with the session key. */
async function askAndCoSign(sessionId: string, sessKey: `0x${string}`) {
  const sessWallet = createWalletClient({ account: privateKeyToAccount(sessKey), chain: arcTestnet, transport: http(config.rpcUrl) });
  // Identify as Keryx's own headless driver so the route tags this self-generated run `engine`,
  // not `web` — the dashboard's external bucket then reflects only genuine third-party askers.
  const askUrl = config.botKey ? `${base}/api/ask?bot=${encodeURIComponent(config.botKey)}` : `${base}/api/ask`;
  const res = await fetch(askUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader() },
    body: JSON.stringify({ question, budget, sessionId }),
  });
  if (!res.ok || !res.body) throw new Error(`/api/ask failed: ${res.status} ${await res.text().catch(() => "")}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const handle = async (event: string, raw: string) => {
    let data: unknown;
    try { data = JSON.parse(raw); } catch { return; }
    if (event === "sign-request") {
      const { reqId, requirements } = data as { reqId: string; requirements: PaymentRequirementsInput };
      try {
        const { header } = await signPaymentAuthorization(sessWallet, requirements);
        await fetch(`${base}/api/ask/sign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, reqId, paymentHeader: header }),
        });
        process.stdout.write("✍");
      } catch (err) {
        console.error(`\n   co-sign failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (event === "done") {
      const run = data as { citations?: { sourceName: string; reward: number }[]; totalToCreators?: number; answer?: string };
      console.log(`\n✅ Answered. Paid ${run.citations?.length ?? 0} creator(s) $${run.totalToCreators ?? 0} (origin=engine, self-driven):`);
      for (const c of run.citations ?? []) console.log(`   • ${c.sourceName}: $${c.reward}`);
    } else if (event === "error") {
      console.error(`\n   stream error: ${(data as { message?: string }).message}`);
    }
  };
  let done = false;
  while (!done) {
    const { done: d, value } = await reader.read();
    if (d) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, sep); buf = buf.slice(sep + 2);
      let event = "message"; const dl: string[] = [];
      for (const ln of block.split("\n")) {
        if (ln.startsWith("event:")) event = ln.slice(6).trim();
        else if (ln.startsWith("data:")) dl.push(ln.slice(5).trim());
      }
      if (dl.length) await handle(event, dl.join("\n"));
      if (event === "done") done = true;
    }
  }
}

console.log(`\n🌐 Keryx headless web client → ${base}`);
console.log(`   question: "${question}"  ·  budget $${budget}\n`);
const sess = await ensureFundedSession();
console.log(`   session active · cap $${sess.cap.toFixed(6)} · spending own funds via browser co-sign\n`);
await askAndCoSign(sess.sessionId, sess.sessKey);
console.log();
process.exit(0);
