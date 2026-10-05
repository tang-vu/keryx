/** Actual claim/connect/register React with synthetic API/wallet only. All HTTP is intercepted. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { circleSdkBrowserPlugin } from "./circle-sdk-browser-plugin.mts";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Route } from "playwright";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../lib/arc-network-profile";
import { sourceClaimProof, type SourceClaim, type SourceClaimChallenge } from "../lib/sources/public-source-claim";
import { registrationId } from "../lib/sources/registration-status";

const owner = `0x${"1".repeat(40)}`, other = `0x${"2".repeat(40)}`, registry = `0x${"3".repeat(40)}`;
const canonicalUrl = "https://publisher.example/article", claimId = "a".repeat(64), urlHash = `0x${"4".repeat(64)}` as const;
const sourceId = registrationId(owner, urlHash), tx = `0x${"5".repeat(64)}`;
const receipt = { status: "success", transactionHash: tx, logs: [{ address: registry, topics: encodeEventTopics({ abi: [{ type: "event", name: "SourceRegistered", inputs: [{ name: "id", type: "bytes32", indexed: true }, { name: "creator", type: "address", indexed: true }, { name: "contentCid", type: "string", indexed: false }] }], eventName: "SourceRegistered", args: { id: sourceId, creator: owner } }), data: encodeAbiParameters([{ type: "string" }], [""]) }] };
const css = (await postcss([tailwind()]).process(await readFile("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
const artifacts = path.resolve(".artifacts/public-source-claim-ui");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const profile of [ARC_TESTNET_PROFILE, ARC_MAINNET_PROFILE]) {
    const bundle = await build({ stdin: { contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import{PublicSourceClaimForm}from'./components/keryx/public-source-claim-form';
import RegisterPage from'./app/register/page';import ConnectPage from'./app/connect/page';
import{sourceClaimDraft}from'./lib/registration-return';
window.wallet={address:sessionStorage.getItem('wallet')||'${owner}',isConnected:true,chainId:${profile.chainId}};
window.walletWrites=[];window.walletSigns=0;window.timeOffset=0;const originalNow=Date.now;Date.now=()=>originalNow()+window.timeOffset;
window.holdUiClock=new URLSearchParams(location.search).has('holdUiClock');const originalInterval=window.setInterval;window.setInterval=(callback,delay,...args)=>delay===1000&&typeof callback==='function'?originalInterval((...values)=>{if(!window.holdUiClock)callback(...values)},delay,...args):originalInterval(callback,delay,...args);
window.setWallet=(address,chainId=${profile.chainId})=>{window.wallet={address,isConnected:!!address,chainId};window.dispatchEvent(new Event('wallet-change'));};
createRoot(document.getElementById('root')).render(location.pathname==='/register'?<RegisterPage/>:location.pathname==='/connect'?<ConnectPage/>:<main className="mx-auto max-w-3xl px-4 py-10 sm:px-8"><PublicSourceClaimForm initial={sourceClaimDraft(new URLSearchParams(location.search))}/></main>);
`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env": "{}", "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": JSON.stringify(profile.name), "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": JSON.stringify(registry), "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": JSON.stringify(registry) },
      plugins: [circleSdkBrowserPlugin(), { name: "synthetic-boundaries", setup(b) {
        b.onResolve({ filter: /^(wagmi|sonner|next\/link)$/ }, args => ({ path: args.path, namespace: "synthetic" }));
        b.onResolve({ filter: /(site-header|bulk-import-form|claim-onchain-panel|faucet-panel|withdraw-earnings-panel|sources-list|account-sessions|wallet-picker)$/ }, args => ({ path: args.path, namespace: "stub" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ loader: "jsx", contents: "export const SiteHeader=()=>null,BulkImportForm=()=>null,ClaimOnchainPanel=()=>null,FaucetPanel=()=>null,WithdrawEarningsPanel=()=>null,SourcesList=()=>null,AccountSessions=()=>null,WalletPicker=()=>null;" }));
        b.onLoad({ filter: /.*/, namespace: "synthetic" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents: args.path === "wagmi" ? `import{useSyncExternalStore}from'react';const subscribe=fn=>{window.addEventListener('wallet-change',fn);return()=>window.removeEventListener('wallet-change',fn)};export const useConnect=()=>({connectors:[],isPending:false,connectAsync:async()=>{throw Error("Unexpected Google connector in external-wallet fixture")}});export const useAccount=()=>useSyncExternalStore(subscribe,()=>window.wallet);export const useChainId=()=>useAccount().chainId;export const useSwitchChain=()=>({isPending:false,switchChain:({chainId})=>window.setWallet(window.wallet.address,chainId)});export const useSignMessage=()=>({signMessageAsync:async()=>{window.walletSigns++;return'synthetic-signature'}});export const useWriteContract=()=>({writeContractAsync:async args=>{window.walletWrites.push(args);return'${tx}'}});export const usePublicClient=()=>({getChainId:async()=>${profile.chainId},waitForTransactionReceipt:async()=>(${JSON.stringify(receipt)})});export const useDisconnect=()=>({disconnect:()=>{},disconnectAsync:async()=>{}});` : args.path === "sonner" ? "export const toast=()=>{};toast.success=toast;toast.error=toast;toast.loading=toast;toast.dismiss=toast;" : "import React from'react';export default function Link({children,...props}){return<a {...props}>{children}</a>}" }));
      } }] });
    const html = `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`;
    for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 900 }]) {
      const context = await browser.newContext({ viewport });
      let authenticated = false, sessionOwner = owner, stored: SourceClaim | null = null, challenge: SourceClaimChallenge | null = null;
      let proofResult = "missing", held: Route | undefined, heldList: Route | undefined, indexed = false, fetchPrice = 0, policyConflict = false, holdList = false, wrongListScope = false;
      const policies: Record<string, unknown>[] = [], registrations: Record<string, unknown>[] = [], links: Record<string, unknown>[] = [], errors: string[] = [];
      let challengeCalls = 0, verifyCalls = 0;
      let expectedCanonical = canonicalUrl;
      const feedHomepage = "https://publisher.example/";
      const challengeResponse = () => ({ challenge, proof: sourceClaimProof(challenge!), proofToken: `keryx-source-claim-v1:${challenge!.nonce}:${"c".repeat(64)}`, proofUrl: challenge!.proofMethod === "rss-channel" ? challenge!.rssUrl : "https://publisher.example/.well-known/keryx-source-claim.json", claim: stored });
      await context.route("**/*", async route => {
        const req = route.request(), url = new URL(req.url()), pathname = url.pathname;
        assert.equal(url.origin, "https://claim.test", `Unexpected external HTTP: ${req.url()}`);
        if (pathname === "/api/auth/session") return route.fulfill({ status: authenticated ? 200 : 401, json: { session: authenticated ? { address: sessionOwner, role: "asker" } : null } });
        if (pathname === "/api/auth/nonce") { const now = Date.now(); return route.fulfill({ json: { nonce: "ClaimFixtureNonce123", issuedAt: new Date(now).toISOString(), challengeExpiresAt: new Date(now + 300000).toISOString(), sessionExpiresAt: new Date(now + 7 * 86400000).toISOString() } }); }
        if (pathname === "/api/auth/verify") { authenticated = true; return route.fulfill({ json: { ok: true, address: owner, role: "asker" } }); }
        if (pathname === "/api/source-claims") {
          if (!url.searchParams.size) {
            if (holdList) { heldList = route; return; }
            return route.fulfill({ json: { claims: stored ? [{ ...stored, ...(wrongListScope ? { ownerWallet: other } : {}) }] : [] } });
          }
          if (url.searchParams.has("challengeId") && challenge) return route.fulfill({ json: challengeResponse() });
          return route.fulfill({ json: { claim: !url.searchParams.has("canonicalUrl") || url.searchParams.get("canonicalUrl") === stored?.canonicalUrl ? stored : null } });
        }
        if (pathname === "/api/source-claims/challenge") {
          challengeCalls++; assert.equal(req.method(), "POST"); const body = req.postDataJSON(); assert.deepEqual(body, { canonicalUrl: expectedCanonical, ...(expectedCanonical !== canonicalUrl ? { rssUrl: expectedCanonical, proofMethod: "rss-channel" } : {}) });
          const now = Date.now(); challenge = { id: String(challengeCalls).padStart(64, "0"), claimId, wallet: owner, canonicalUrl: expectedCanonical, ...(body.rssUrl ? { rssUrl: body.rssUrl, proofMethod: body.proofMethod } : {}), deploymentOrigin: "https://claim.test", network: profile.networkId, nonce: "b".repeat(64), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 900000).toISOString() };
          return route.fulfill({ json: challengeResponse() });
        }
        if (pathname === "/api/source-claims/verify") {
          verifyCalls++; assert.deepEqual(req.postDataJSON(), { challengeId: challenge!.id });
          if (proofResult === "held") { held = route; return; }
          if (proofResult !== "present") return route.fulfill({ status: proofResult === "conflict" ? 409 : 422, json: { error: proofResult === "conflict" ? "This source is already claimed by another wallet." : "The proof file could not be verified. Publish the exact file without redirects and retry." } });
          const now = new Date().toISOString(); stored = stored?.canonicalUrl === challenge!.canonicalUrl ? { ...stored, verifiedAt: now, revision: stored.revision + 1 } : { id: claimId, canonicalUrl: challenge!.canonicalUrl, ...(challenge!.rssUrl ? { rssUrl: challenge!.rssUrl, proofMethod: challenge!.proofMethod } : {}), ownerWallet: owner, deploymentOrigin: "https://claim.test", network: profile.networkId, verifiedAt: now, revision: 1, effectiveAt: now, mode: "free", distributionPermission: false };
          return route.fulfill({ json: { claim: stored } });
        }
        if (pathname === `/api/source-claims/${claimId}/link`) { const body = req.postDataJSON(); links.push(body); assert.deepEqual(body, { expectedRevision: stored!.revision, sourceId }); stored = { ...stored!, revision: stored!.revision + 1, linkedSourceId: sourceId, onchainId: sourceId, registryAddress: registry }; return route.fulfill({ json: { claim: stored } }); }
        if (pathname === `/api/source-claims/${claimId}/policy`) { const body = req.postDataJSON(); policies.push(body); if (policyConflict) return route.fulfill({ status: 409, json: { error: "Source policy changed. Reload before reviewing activation again." } }); assert.equal(body.expectedRevision, stored!.revision); assert.equal(body.distributionPermission, body.mode !== "free"); stored = { ...stored!, revision: stored!.revision + 1, mode: body.mode, distributionPermission: body.distributionPermission, effectiveAt: new Date().toISOString() }; return route.fulfill({ json: { claim: stored } }); }
        if (pathname === "/api/sources") {
          if (req.method() === "GET") return route.fulfill({ json: { sources: indexed ? [{ id: sourceId, name: "Publisher", url: canonicalUrl, walletAddress: owner, onchainId: sourceId, fetchPrice }] : [] } });
          const registration = req.postDataJSON();
          if (registration.rssUrl) {
            assert.notEqual(expectedCanonical, feedHomepage, "Fixture must distinguish feed URL from feed.link homepage");
            assert.equal(registration.rssUrl, expectedCanonical);
            assert.equal(registration.url, expectedCanonical, "Claim registration must carry its locked canonical URL instead of deriving feed.link");
          }
          registrations.push(registration); indexed = true; fetchPrice = registrations.at(-1)!.fetchPrice as number;
          return route.fulfill({ json: { mode: "onchain", sourceId, registryAddress: registry, registerParams: { urlHash, payoutWallet: owner, authors: [{ wallet: owner, basisPoints: 10000 }], fetchPriceUsdc6: String(Math.round(fetchPrice * 1e6)), contentCid: "", tags: "" } } });
        }
        if (pathname.endsWith("/listing")) return route.fulfill({ json: { mode: "onchain", onchainId: sourceId, registryAddress: registry, creator: owner } });
        assert(!pathname.startsWith("/api/"), `Unexpected API: ${pathname}`); assert.equal(req.method(), "GET");
        return route.fulfill({ contentType: "text/html", body: html });
      });
      const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
      await page.goto(`https://claim.test/claim-source?url=${encodeURIComponent(canonicalUrl)}`);
      await page.getByRole("link", { name: "Connect and sign in to claim" }).click();
      await page.getByRole("button", { name: "Sign in with Ethereum ▸" }).click();
      await page.getByRole("link", { name: "Resume source claim" }).click();
      await page.getByRole("button", { name: "Create ownership proof", exact: true }).click();
      await page.getByRole("heading", { name: "2. Publish your proof file" }).waitFor();
      assert.equal(policies.length, 0); assert.equal(registrations.length, 0); assert.equal(await page.evaluate(() => (window as unknown as { walletSigns: number }).walletSigns), 0);
      const proofUrl = page.url(); assert.match(proofUrl, /challengeId=/);
      await page.reload(); await page.getByRole("textbox", { name: "Proof file contents" }).waitFor();
      await page.getByRole("button", { name: "Check ownership", exact: true }).click(); await page.getByText(/The proof file could not be verified/).waitFor();
      proofResult = "conflict"; await page.getByRole("button", { name: "Check ownership", exact: true }).click(); await page.getByText("This source is already claimed by another wallet.").waitFor();
      await page.evaluate(() => { (window as unknown as { timeOffset: number }).timeOffset = 960000; });
      await page.getByText(/This proof expired/).waitFor(); assert(await page.getByRole("button", { name: "Check ownership", exact: true }).isDisabled());
      await page.evaluate(() => { (window as unknown as { timeOffset: number }).timeOffset = 0; });
      await page.getByRole("button", { name: "Replace proof file", exact: true }).click(); proofResult = "present";
      await page.getByRole("button", { name: "Check ownership", exact: true }).click(); await page.getByRole("heading", { name: "Source control verified" }).waitFor();
      assert.equal(policies.length, 0); assert.equal(registrations.length, 0); assert.equal(stored!.mode, "free");
      await page.reload(); await page.getByRole("heading", { name: "Source control verified" }).waitFor();
      await page.getByRole("radio", { name: /Citation rewards/ }).check();
      const register = page.getByRole("link", { name: "Register a new listing for this claim" }); const registerUrl = await register.getAttribute("href");
      assert.equal(new URL(registerUrl!, "https://claim.test").searchParams.get("fetchPrice"), "0");
      await register.click(); await page.locator("#price").waitFor(); assert.equal(await page.locator("#price").inputValue(), "0");
      await page.getByRole("button", { name: "Publish source ▸" }).click(); await page.getByText(/Registration confirmed and indexed:/).waitFor();
      assert.equal(registrations.length, 1); assert.equal(registrations[0].sourceClaimId, claimId); assert.equal(registrations[0].fetchPrice, 0); assert.equal(policies.length, 0);
      await page.getByRole("link", { name: "Return to source claim", exact: true }).click();
      await page.getByRole("combobox", { name: "Existing listing for this source" }).selectOption(sourceId);
      await page.getByRole("button", { name: "Connect existing listing" }).click();
      await page.getByText(/Connected listing:/).waitFor();
      assert.equal(links.length, 1); assert.equal(policies.length, 0);
      await page.getByRole("radio", { name: /Citation rewards/ }).check(); const activate = page.getByRole("button", { name: "Activate citation rewards", exact: true }); assert(await activate.isDisabled());
      await page.getByRole("checkbox", { name: /I have the rights to distribute/ }).check(); assert(!await activate.isDisabled());
      policyConflict = true; await activate.click(); await page.getByText(/Source policy changed/).waitFor(); assert.equal(stored!.mode, "free");
      policyConflict = false; await page.getByRole("button", { name: "Reload current claim status" }).click();
      await page.waitForFunction(() => (document.querySelector('input[name="source-claim-mode"][value="free"]') as HTMLInputElement | null)?.checked);
      await page.getByRole("radio", { name: /Citation rewards/ }).check(); assert(await page.getByRole("button", { name: "Activate citation rewards" }).isDisabled());
      await page.getByRole("checkbox", { name: /I have the rights to distribute/ }).check(); await page.getByRole("button", { name: "Activate citation rewards" }).click();
      await page.getByText(/This earning policy is saved/).waitFor(); assert.equal(stored!.mode, "citation-only");
      await page.getByRole("radio", { name: /Paid reads/ }).check(); await page.getByRole("checkbox", { name: /I have the rights to distribute/ }).check(); assert(await page.getByRole("button", { name: "Activate paid reads" }).isDisabled());
      fetchPrice = 0.02; await page.getByRole("button", { name: "Refresh indexed listings" }).click(); await page.getByText("$0.02 USDC", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Activate paid reads" }).click(); await page.getByText(/This earning policy is saved/).waitFor(); assert.equal(stored!.mode, "paid");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Actual generated CSS must fit ${viewport.width}px`);
      const count = policies.length;
      // A fast fresh-list read before the first clock tick must not announce expiry.
      const beforeFreshList = { challengeCalls, verifyCalls, policies: policies.length };
      await page.goto("https://claim.test/claim-source?holdUiClock=1");
      await page.getByRole("button", { name: "Load my source claims" }).click();
      const freshList = page.getByRole("region", { name: "Your source claims" });
      await freshList.getByText(/Checking control proof freshness/).waitFor();
      assert.equal(await freshList.getByText(/Control verification expired/).count(), 0);
      await page.evaluate(() => { (window as unknown as { holdUiClock: boolean }).holdUiClock = false; });
      await freshList.getByText(/Control proof is current/).waitFor();
      assert.deepEqual({ challengeCalls, verifyCalls, policies: policies.length }, beforeFreshList);
      await freshList.getByRole("link", { name: "Review or re-verify this source" }).click();
      await page.getByRole("heading", { name: "Source control verified" }).waitFor();
      await page.evaluate(chainId => (window as unknown as { setWallet: (address: string, chainId: number) => void }).setWallet("0x" + "1".repeat(40), chainId), profile.testnet ? 5042 : 5042002);
      await page.getByText(/Switch your wallet to/).waitFor(); assert.equal(await page.getByRole("button", { name: "Activate paid reads" }).count(), 0); assert.equal(policies.length, count);
      await page.reload(); await page.getByRole("heading", { name: "Source control verified" }).waitFor();
      await page.getByRole("button", { name: "Create fresh ownership proof" }).click(); proofResult = "held";
      await page.getByRole("button", { name: "Check ownership", exact: true }).click(); await page.waitForFunction(() => document.body.textContent?.includes("Checking source claim…"));
      assert(held); await page.evaluate(address => (window as unknown as { setWallet: (address: string) => void }).setWallet(address), other);
      await page.getByRole("link", { name: "Connect and sign in to claim" }).waitFor(); await held.fulfill({ json: { claim: { ...stored!, revision: stored!.revision + 1 } } });
      assert.equal(await page.getByRole("heading", { name: "Source control verified" }).count(), 0); assert.equal(policies.length, count);
      assert.equal(verifyCalls, 4);
      // Expired control visibly pauses policy and never automatically rechecks or activates it.
      stored = { ...stored!, verifiedAt: new Date(Date.now() - 2 * 86400000).toISOString() };
      await page.goto(`https://claim.test/claim-source?claimId=${claimId}`); await page.getByText(/Control verification expired/).waitFor();
      assert.equal(await page.getByText(/This earning policy is saved/).count(), 0); assert.equal(policies.length, count);
      await page.getByRole("radio", { name: /^Free Free reads/ }).check(); assert(!await page.getByRole("button", { name: "Keep this claim free" }).isDisabled(), "Disabling earnings remains available after control expires");
      // Owner-list recovery uses persisted claims, never a renewal or activation on load.
      const staleVerifiedAt = stored!.verifiedAt, beforeRenewal = { challengeCalls, verifyCalls, policies: policies.length };
      await page.goto("https://claim.test/claim-source");
      await page.getByRole("button", { name: "Load my source claims" }).click();
      const owned = page.getByRole("region", { name: "Your source claims" });
      await owned.getByText(/Control verification expired/).waitFor();
      const deadline = new Date(Date.parse(staleVerifiedAt) + 86400000).toISOString();
      assert.equal(await owned.locator("time").nth(1).getAttribute("datetime"), deadline);
      assert.match(await owned.locator("time").nth(1).innerText(), /UTC|GMT/, "Deadline includes the viewer timezone");
      assert.deepEqual({ challengeCalls, verifyCalls, policies: policies.length }, beforeRenewal);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Saved claim list fits the viewport");
      await page.screenshot({ path: path.join(artifacts, `${profile.name}-${viewport.width}-saved-claims.png`), fullPage: true });
      await owned.getByRole("link", { name: "Review or re-verify this source" }).click();
      await page.getByRole("heading", { name: "Source control needs re-verification" }).waitFor();
      assert.equal(await page.getByText(/This earning policy is saved/).count(), 0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Expired claim controls fit the viewport");
      await page.screenshot({ path: path.join(artifacts, `${profile.name}-${viewport.width}-expired-claim.png`), fullPage: true });
      await page.getByRole("button", { name: "Re-verify source control" }).click();
      await page.getByRole("heading", { name: "2. Publish your proof file" }).waitFor();
      assert.equal(verifyCalls, beforeRenewal.verifyCalls, "Creating a fresh challenge must not automatically check ownership");
      proofResult = "missing";
      await page.getByRole("button", { name: "Check ownership", exact: true }).click();
      await page.getByText(/The proof file could not be verified/).waitFor();
      assert.equal(await page.getByText(/This earning policy is saved/).count(), 0);
      proofResult = "present";
      await page.getByRole("button", { name: "Check ownership", exact: true }).click();
      await page.getByRole("heading", { name: "Source control verified" }).waitFor();
      assert.equal(stored!.mode, "paid", "Renewal preserves the existing saved policy");
      assert.equal(policies.length, count, "Renewal must not submit policy activation");
      assert.equal(verifyCalls, beforeRenewal.verifyCalls + 2);
      // Refuse a wrong-scope list and fence a response arriving after wallet change.
      await page.goto("https://claim.test/claim-source"); wrongListScope = true;
      await page.getByRole("button", { name: "Load my source claims" }).click();
      await page.getByText(/The claim list does not match/).waitFor();
      assert.equal(await page.getByRole("link", { name: "Review or re-verify this source" }).count(), 0);
      wrongListScope = false; holdList = true;
      await page.getByRole("button", { name: "Load my source claims" }).click();
      await page.waitForFunction(() => document.body.textContent?.includes("Loading your claims…"));
      assert(heldList);
      await page.evaluate(address => (window as unknown as { setWallet: (address: string) => void }).setWallet(address), other);
      await page.getByRole("link", { name: "Connect and sign in to claim" }).waitFor();
      await heldList.fulfill({ json: { claims: [stored] } });
      assert.equal(await page.getByRole("link", { name: "Review or re-verify this source" }).count(), 0);
      assert.equal(policies.length, count); holdList = false;
      // General RSS sources use the exact feed URL and channel metadata proof, with safe reload.
      expectedCanonical = "https://publisher.example/feed.xml"; stored = null; proofResult = "present";
      await page.goto(`https://claim.test/claim-source?url=${encodeURIComponent(expectedCanonical)}`);
      await page.getByRole("radio", { name: "Publish a token in the RSS / Atom channel" }).check();
      await page.getByRole("button", { name: "Create ownership proof", exact: true }).click();
      await page.getByRole("heading", { name: "2. Publish your channel token" }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Download proof file" }).count(), 0);
      await page.getByText(/Tokens inside posts, comments and item text do not prove ownership/).waitFor();
      await page.reload(); await page.getByRole("textbox", { name: "Channel proof token" }).waitFor();
      await page.getByRole("button", { name: "Check ownership", exact: true }).click(); await page.getByRole("heading", { name: "Source control verified" }).waitFor();
      assert.equal(stored!.proofMethod, "rss-channel"); assert.equal(stored!.mode, "free"); assert.equal(policies.length, count);
      // Feed publishers commonly advertise a different homepage in feed.link. Preserve the
      // claimed feed identity in the actual registration request, including a zero read price.
      indexed = false; await page.getByRole("button", { name: "Refresh indexed listings" }).click();
      await page.getByRole("radio", { name: /Citation rewards/ }).check();
      await page.getByRole("link", { name: "Register a new listing for this claim" }).click();
      await page.locator("#rss").waitFor(); assert.equal(await page.locator("#rss").inputValue(), expectedCanonical);
      assert.equal(await page.locator("#price").inputValue(), "0");
      await page.getByRole("button", { name: "Publish source ▸" }).click(); await page.getByText(/Registration confirmed and indexed:/).waitFor();
      assert.equal(registrations.length, 2); assert.equal(registrations[1].rssUrl, expectedCanonical);
      assert.equal(registrations[1].url, expectedCanonical); assert.notEqual(registrations[1].url, feedHomepage);
      assert.equal(registrations[1].sourceClaimId, claimId); assert.equal(registrations[1].fetchPrice, 0); assert.equal(policies.length, count);
      assert.deepEqual(errors, []); await context.close();
      console.log(`PASS ${profile.name}/${viewport.width}px: signed-in resume, proof expiry/conflict/failure, owner-list renewal with preserved policy, exact deadlines, stale owner-list/wallet/network refusal, zero-price registration, explicit rights/policy activation. All transport and wallet synthetic.`);
    }
  }
} finally { await browser.close(); }
