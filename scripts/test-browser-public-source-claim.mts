/** Actual claim/connect/register React with synthetic API/wallet only. All HTTP is intercepted. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { circleSdkBrowserPlugin } from "./circle-sdk-browser-plugin.mts";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Route, type Response } from "playwright";
import { encodeAbiParameters, encodeEventTopics, keccak256, toBytes } from "viem";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../lib/arc-network-profile";
import { sourceClaimProof, type SourceClaim, type SourceClaimChallenge } from "../lib/sources/public-source-claim";
import { registrationId } from "../lib/sources/registration-status";
import { registrationIntentDigest, type SponsoredRegistration } from "../lib/sources/registration-sponsor-protocol";

const owner = `0x${"1".repeat(40)}` as const, other = `0x${"2".repeat(40)}` as const, registry = `0x${"3".repeat(40)}` as const;
const canonicalUrl = "https://publisher.example/article", claimId = "a".repeat(64), urlHash = `0x${"4".repeat(64)}` as const;
const sourceId = registrationId(owner, urlHash), tx = `0x${"5".repeat(64)}` as const;
const sponsor = `0x${"6".repeat(40)}` as const, policyDigest = `0x${"7".repeat(64)}` as const;
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
window.walletWrites=[];window.walletSigns=0;window.typedSigns=[];window.timeOffset=0;const originalNow=Date.now;Date.now=()=>originalNow()+window.timeOffset;
window.holdUiClock=new URLSearchParams(location.search).has('holdUiClock');const originalInterval=window.setInterval;window.setInterval=(callback,delay,...args)=>delay===1000&&typeof callback==='function'?originalInterval((...values)=>{if(!window.holdUiClock)callback(...values)},delay,...args):originalInterval(callback,delay,...args);
window.setWallet=(address,chainId=${profile.chainId})=>{window.wallet={address,isConnected:!!address,chainId};window.dispatchEvent(new Event('wallet-change'));};
createRoot(document.getElementById('root')).render(location.pathname==='/register'?<RegisterPage/>:location.pathname==='/connect'?<ConnectPage/>:<main className="mx-auto max-w-3xl px-4 py-10 sm:px-8"><PublicSourceClaimForm initial={sourceClaimDraft(new URLSearchParams(location.search))}/></main>);
`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env": "{}", "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": JSON.stringify(profile.name), "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": JSON.stringify(registry), "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": JSON.stringify(registry), "process.env.NEXT_PUBLIC_KERYX_REGISTRY_VERSION": '"3"' },
      plugins: [circleSdkBrowserPlugin(), { name: "synthetic-boundaries", setup(b) {
        b.onResolve({ filter: /^(wagmi(?:\/actions)?|sonner|next\/link)$/ }, args => ({ path: args.path, namespace: "synthetic" }));
        b.onResolve({ filter: /(site-header|bulk-import-form|claim-onchain-panel|faucet-panel|withdraw-earnings-panel|sources-list|account-sessions|wallet-picker)$/ }, args => ({ path: args.path, namespace: "stub" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ loader: "jsx", contents: "export const SiteHeader=()=>null,BulkImportForm=()=>null,ClaimOnchainPanel=()=>null,FaucetPanel=()=>null,WithdrawEarningsPanel=()=>null,SourcesList=()=>null,AccountSessions=()=>null,WalletPicker=()=>null;" }));
        b.onLoad({ filter: /.*/, namespace: "synthetic" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents: args.path === "wagmi/actions" ? "export const getConnection=()=>({...window.wallet,status:window.wallet.isConnected?'connected':'disconnected'});" : args.path === "wagmi" ? `import{useSyncExternalStore}from'react';const subscribe=fn=>{window.addEventListener('wallet-change',fn);return()=>window.removeEventListener('wallet-change',fn)};export const useConnect=()=>({connectors:[],isPending:false,connectAsync:async()=>{throw Error("Unexpected Google connector in external-wallet fixture")}});export const useAccount=()=>useSyncExternalStore(subscribe,()=>window.wallet);export const useConfig=()=>({});export const useSignTypedData=()=>({signTypedDataAsync:async args=>{window.typedSigns.push(JSON.parse(JSON.stringify(args,(_,value)=>typeof value==='bigint'?String(value):value)));return'0x'+'1'.repeat(130)}});export const useChainId=()=>useAccount().chainId;export const useSwitchChain=()=>({isPending:false,switchChain:({chainId})=>window.setWallet(window.wallet.address,chainId)});export const useSignMessage=()=>({signMessageAsync:async()=>{window.walletSigns++;return'synthetic-signature'}});export const useWriteContract=()=>({writeContractAsync:async args=>{window.walletWrites.push(args);return'${tx}'}});export const usePublicClient=()=>({getChainId:async()=>${profile.chainId},waitForTransactionReceipt:async()=>(${JSON.stringify(receipt)})});export const useDisconnect=()=>({disconnect:()=>{},disconnectAsync:async()=>{}});` : args.path === "sonner" ? "export const toast=()=>{};toast.success=toast;toast.error=toast;toast.loading=toast;toast.dismiss=toast;" : "import React from'react';export default function Link({children,...props}){return<a {...props}>{children}</a>}" }));
      } }] });
    const html = `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`;
    for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 900 }]) {
      const context = await browser.newContext({ viewport });
      let authenticated = false, sessionOwner = owner, stored: SourceClaim | null = null, challenge: SourceClaimChallenge | null = null;
      let proofResult = "missing", held: Route | undefined, heldList: Route | undefined, indexed = false, fetchPrice = 0, policyConflict = false, holdList = false, wrongListScope = false;
      const policies: Record<string, unknown>[] = [], registrations: Record<string, unknown>[] = [], links: Record<string, unknown>[] = [], errors: string[] = [];
      let challengeCalls = 0, verifyCalls = 0;
      let expectedCanonical = canonicalUrl, expectedRss: string | undefined, sponsorAvailable = false;
      let unifiedFixture = false, sponsorRow: SponsoredRegistration | null = null, sponsorIndex = "pending";
      let restoreAuthOrder: "child-first" | "parent-first" | null = null, restoreSessionCalls = 0, heldRestoreAuth: Route | undefined;
      let holdRestoreClaim = false, restoreClaimReady: ((route: Route) => void) | undefined;
      const sponsorPosts: Record<string, unknown>[] = [];
      const feedHomepage = "https://publisher.example/";
      const challengeResponse = () => ({ challenge, proof: sourceClaimProof(challenge!), proofToken: `keryx-source-claim-v1:${challenge!.nonce}:${"c".repeat(64)}`, proofUrl: challenge!.proofMethod === "rss-channel" ? challenge!.rssUrl : new URL("/.well-known/keryx-source-claim.json", challenge!.canonicalUrl).toString(), claim: stored });
      await context.route("**/*", async route => {
        const req = route.request(), url = new URL(req.url()), pathname = url.pathname;
        assert.equal(url.origin, "https://claim.test", `Unexpected external HTTP: ${req.url()}`);
        if (pathname === "/api/sources/sponsor") {
          if (req.method() === "POST") {
            assert(unifiedFixture, "Only the declared unified fixture may prepare or submit");
            const body = req.postDataJSON(); sponsorPosts.push(body);
            if (body.operation === "prepare") {
              assert.equal(stored!.ownerWallet, owner); assert.equal(body.claimId, stored!.id); assert.equal(body.fetchPrice, 0.005);
              const now = Date.now(), exactHash = keccak256(toBytes(stored!.canonicalUrl));
              sponsorRow = { id: policyDigest, policyDigest, creator: owner, canonicalUrl: stored!.canonicalUrl, rssUrl: stored!.rssUrl!, claimId: stored!.id, claimRevision: stored!.revision,
                sourceId: "unified-fixture-source", onchainId: registrationId(owner, exactHash), registryAddress: registry, registryCodeHash: policyDigest, relayer: sponsor, chainId: profile.chainId as 5042 | 5042002,
                params: { urlHash: exactHash, payoutWallet: owner, authors: [{ wallet: owner, basisPoints: 10000 }], fetchPriceUsdc6: "5000", contentCid: "", tags: "" }, nonce: "0", deadline: Math.floor(now / 1000) + 600, createdAt: now, updatedAt: now, reservedWei: "40000000000000000", state: "prepared" };
              sponsorRow.id = registrationIntentDigest(sponsorRow);
              stored = { ...stored!, revision: stored!.revision + 1, linkedSourceId: sponsorRow.sourceId, onchainId: sponsorRow.onchainId, registryAddress: registry };
            } else {
              assert.equal(body.operation, "submit"); assert.equal(body.id, sponsorRow!.id); assert.equal(body.signature, "0x" + "1".repeat(130));
              sponsorRow = { ...sponsorRow!, state: "confirmed", transactionHash: tx, transactionNonce: 0, actualGasWei: "1000000000000000" };
            }
            return route.fulfill({ json: { original: sponsorRow } });
          }
          if (url.searchParams.size) {
            if (!sponsorRow) return route.fulfill({ status: 404, json: { error: "No original" } });
            assert.equal(url.searchParams.get("id") ?? url.searchParams.get("claimId"), url.searchParams.has("id") ? sponsorRow.id : sponsorRow.claimId);
            return route.fulfill({ json: { original: sponsorRow } });
          }
          return route.fulfill({ json: { available: sponsorAvailable, ...(!sponsorAvailable && unifiedFixture ? { reason: "insufficient-balance" } : {}), eligibility: "verified-publisher", funding: "wallet-balance", sponsorAddress: sponsor, policyDigest, maxGasWei: "40000000000000000" } });
        }
        if (pathname === "/api/auth/session") {
          if (restoreAuthOrder && ++restoreSessionCalls === (restoreAuthOrder === "child-first" ? 2 : 1)) { heldRestoreAuth = route; return; }
          return route.fulfill({ status: authenticated ? 200 : 401, json: { session: authenticated ? { address: sessionOwner, role: "asker" } : null } });
        }
        if (pathname === "/api/auth/nonce") { const now = Date.now(); return route.fulfill({ json: { nonce: "ClaimFixtureNonce123", issuedAt: new Date(now).toISOString(), challengeExpiresAt: new Date(now + 300000).toISOString(), sessionExpiresAt: new Date(now + 7 * 86400000).toISOString() } }); }
        if (pathname === "/api/auth/verify") { authenticated = true; return route.fulfill({ json: { ok: true, address: owner, role: "asker" } }); }
        if (pathname === "/api/source-claims") {
          if (holdRestoreClaim && url.searchParams.has("claimId")) { holdRestoreClaim = false; assert(restoreClaimReady); restoreClaimReady(route); return; }
          if (!url.searchParams.size) {
            if (holdList) { heldList = route; return; }
            return route.fulfill({ json: { claims: stored ? [{ ...stored, ...(wrongListScope ? { ownerWallet: other } : {}) }] : [] } });
          }
          if (url.searchParams.has("challengeId") && challenge) return route.fulfill({ json: challengeResponse() });
          return route.fulfill({ json: { claim: !url.searchParams.has("canonicalUrl") || url.searchParams.get("canonicalUrl") === stored?.canonicalUrl ? stored : null } });
        }
        if (pathname === "/api/source-claims/challenge") {
          challengeCalls++; assert.equal(req.method(), "POST"); const body = req.postDataJSON(); assert.deepEqual(body, { canonicalUrl: expectedCanonical,
            ...(expectedRss ? { rssUrl: expectedRss, ...(body.proofMethod === "rss-channel" ? { proofMethod: "rss-channel" } : {}) } : expectedCanonical !== canonicalUrl ? { rssUrl: expectedCanonical, proofMethod: "rss-channel" } : {}) });
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
          if (req.method() === "GET") return route.fulfill({ json: { sources: indexed ? [{ id: unifiedFixture ? sponsorRow!.sourceId : sourceId, name: "Publisher", url: stored?.canonicalUrl ?? canonicalUrl, rssUrl: stored?.rssUrl, walletAddress: owner, onchainId: unifiedFixture ? sponsorRow!.onchainId : sourceId, fetchPrice }] : [] } });
          const registration = req.postDataJSON();
          if (registration.rssUrl) {
            assert.notEqual(expectedCanonical, feedHomepage, "Fixture must distinguish feed URL from feed.link homepage");
            assert.equal(registration.rssUrl, expectedCanonical);
            assert.equal(registration.url, expectedCanonical, "Claim registration must carry its locked canonical URL instead of deriving feed.link");
          }
          registrations.push(registration); indexed = true; fetchPrice = registrations.at(-1)!.fetchPrice as number;
          return route.fulfill({ json: { mode: "onchain", sourceId, registryAddress: registry, registerParams: { urlHash, payoutWallet: owner, authors: [{ wallet: owner, basisPoints: 10000 }], fetchPriceUsdc6: String(Math.round(fetchPrice * 1e6)), contentCid: "", tags: "" } } });
        }
        if (pathname.endsWith("/listing")) {
          if (unifiedFixture) { indexed = sponsorIndex === "match"; return route.fulfill({ json: { mode: sponsorIndex === "pending" ? "pending" : "onchain", onchainId: sponsorRow!.onchainId, registryAddress: sponsorIndex === "mismatch" ? other : registry, creator: owner } }); }
          return route.fulfill({ json: { mode: "onchain", onchainId: sourceId, registryAddress: registry, creator: owner } });
        }
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
      assert.equal(await owned.locator("time").count(), 2, "Verification and deadline each have one time element");
      assert.equal(await owned.locator("time time").count(), 0, "Claim timestamps are not nested");
      assert.equal(await owned.locator("time").nth(0).getAttribute("datetime"), staleVerifiedAt);
      assert.equal(await owned.locator("time").nth(1).getAttribute("datetime"), deadline);
      assert.equal(await owned.locator("time").nth(1).getAttribute("title"), deadline, "Exact UTC deadline remains available on hover");
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
      // Website-file publishers retain their exact paired RSS through sign-in and
      // proof verification, then get a direct sponsor handoff without spending.
      expectedCanonical = feedHomepage; expectedRss = "https://publisher.example/feed.xml";
      stored = null; indexed = false; sponsorAvailable = true;
      await page.goto(`https://claim.test/claim-source?url=${encodeURIComponent(expectedCanonical)}&rss=${encodeURIComponent(expectedRss)}`);
      assert.equal(await page.getByLabel("RSS feed URL (optional)").inputValue(), expectedRss);
      await page.getByRole("button", { name: "Create ownership proof", exact: true }).click();
      await page.getByRole("heading", { name: "2. Publish your proof file" }).waitFor();
      assert.equal(challenge!.canonicalUrl, feedHomepage); assert.equal(challenge!.rssUrl, expectedRss);
      assert.equal(challenge!.proofMethod, undefined);
      await page.reload(); assert.equal(await page.getByLabel("RSS feed URL (optional)").inputValue(), expectedRss);
      await page.getByRole("button", { name: "Check ownership", exact: true }).click();
      await page.getByRole("heading", { name: "Source control verified" }).waitFor();
      const sponsorLink = page.getByRole("link", { name: "Use sponsored registration ▸" });
      await sponsorLink.waitFor(); const sponsoredTarget = new URL((await sponsorLink.getAttribute("href"))!, "https://claim.test");
      assert.equal(sponsoredTarget.pathname, "/register"); assert.equal(sponsoredTarget.searchParams.get("sourceClaimId"), claimId); assert.equal(sponsoredTarget.searchParams.get("rss"), expectedRss); assert.equal(sponsoredTarget.searchParams.get("owner"), owner);
      assert.equal(stored!.rssUrl, expectedRss); assert.equal(registrations.length, 2); assert.equal(policies.length, count);

      // Actual /register: one page for an unrelated verified publisher, exact chosen price,
      // real SIWE UI, synthetic publishing proof/contract API, no external control assertion.
      unifiedFixture = true; expectedCanonical = "https://independent.example/news.xml"; expectedRss = expectedCanonical;
      stored = null; challenge = null; sponsorRow = null; indexed = false; authenticated = false; proofResult = "missing"; fetchPrice = 0.005;
      await page.goto(`https://claim.test/register?fetchPrice=0.005&chainId=${profile.chainId}`);
      await page.getByRole("heading", { name: "Register your source", exact: true }).waitFor();
      assert.equal(await page.getByRole("heading", { name: "1. Choose your source", exact: true }).count(), 0, "Embedded source form does not duplicate the outer numbered step");
      assert.equal(await page.getByLabel("RSS feed URL (optional)", { exact: true }).count(), 0);
      await page.getByLabel("RSS feed URL (required)", { exact: true }).fill(expectedRss);
      assert.equal(await page.locator("#claim-source-url").inputValue(), expectedCanonical, "A new unbound draft uses its exact feed identity, so either proof method works");
      const signIn = page.getByRole("link", { name: "Connect and sign in to claim", exact: true });
      const signinTarget = new URL((await signIn.getAttribute("href"))!, "https://claim.test").searchParams.get("returnTo")!;
      assert.equal(new URL(signinTarget, "https://claim.test").searchParams.get("fetchPrice"), "0.005");
      assert.equal(new URL(signinTarget, "https://claim.test").searchParams.get("rss"), expectedRss);
      await signIn.click(); await page.getByRole("button", { name: "Sign in with Ethereum ▸", exact: true }).click();
      await page.getByRole("link", { name: /Resume source registration/ }).click();
      await page.getByRole("button", { name: "Create ownership proof", exact: true }).waitFor();
      const beforeUnifiedProof = challengeCalls;
      await page.getByLabel("RSS feed URL (required)", { exact: true }).fill("");
      await page.getByRole("button", { name: "Create ownership proof", exact: true }).click();
      await page.getByText("Include your exact HTTPS RSS feed before creating the ownership proof.", { exact: true }).waitFor();
      assert.equal(challengeCalls, beforeUnifiedProof); assert.equal(sponsorPosts.length, 0);
      await page.getByLabel("RSS feed URL (required)", { exact: true }).fill("https://foreign.example/rss.xml");
      await page.getByRole("button", { name: "Create ownership proof", exact: true }).click();
      await page.getByText("Use a full HTTPS feed URL on the same publisher origin.", { exact: true }).waitFor();
      assert.equal(challengeCalls, beforeUnifiedProof);
      await page.getByLabel("RSS feed URL (required)", { exact: true }).fill(expectedRss);
      await page.getByRole("button", { name: "Create ownership proof", exact: true }).click();
      await page.getByRole("heading", { name: "Publish your proof file", exact: true }).waitFor();
      const retained = new URL(page.url()).searchParams;
      assert.equal(retained.get("fetchPrice"), "0.005"); assert.equal(retained.get("owner"), owner); assert.equal(retained.get("chainId"), String(profile.chainId));
      assert.equal(retained.get("challengeId"), challenge!.id); assert.equal(retained.get("rss"), expectedRss);
      await page.reload(); await page.getByRole("textbox", { name: "Proof file contents", exact: true }).waitFor();
      await page.getByRole("button", { name: "Check ownership", exact: true }).click(); await page.getByText(/The proof file could not be verified/).waitFor();
      assert.equal(await page.getByRole("button", { name: "Prepare sponsored registration", exact: true }).count(), 0); assert.equal(sponsorPosts.length, 0); assert.equal(policies.length, count);
      proofResult = "present"; await page.getByRole("button", { name: "Check ownership", exact: true }).click();
      const prepareInline = page.getByRole("button", { name: "Prepare sponsored registration", exact: true }); await prepareInline.waitFor();
      assert.equal(await page.getByLabel("Price per read (USDC)", { exact: true }).inputValue(), "0.005");
      const typedPrice = page.getByLabel("Price per read (USDC)", { exact: true });
      await typedPrice.fill(""); await typedPrice.pressSequentially("0.005", { delay: 60 });
      assert.equal(await typedPrice.inputValue(), "0.005", "Parent price acknowledgements preserve a creator's decimal typing and cursor");
      assert.equal(new URL(page.url()).searchParams.get("fetchPrice"), "0.005");
      assert.equal(await page.getByLabel("Recover original request", { exact: true }).isVisible(), false, "Saved-original controls are collapsed advanced recovery");
      assert.equal(new URL(page.url()).pathname, "/register"); assert.equal(sponsorPosts.length, 0); assert.equal(policies.length, count);
      await prepareInline.click(); await page.getByRole("button", { name: "Sign reviewed registration", exact: true }).waitFor();
      assert.equal(sponsorPosts.length, 1); assert.equal(sponsorPosts[0].fetchPrice, 0.005);
      await page.getByText("Price per read: 0.005000 USDC", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => (window as unknown as { typedSigns: unknown[] }).typedSigns.length), 0);
      const preparedUrl = page.url(), preparedOriginalId = sponsorRow!.id;
      await page.goto("https://claim.test/register");
      const savedRecovery = page.getByRole("region", { name: "Saved registration recovery", exact: true });
      await savedRecovery.locator("summary").click();
      await savedRecovery.getByLabel("Recover original request", { exact: true }).fill(preparedOriginalId);
      await savedRecovery.getByRole("button", { name: "Inspect saved request", exact: true }).click();
      await savedRecovery.getByLabel("Original request", { exact: true }).waitFor();
      assert.equal(await savedRecovery.getByLabel("Original request", { exact: true }).inputValue(), preparedOriginalId);
      assert.equal(await savedRecovery.getByRole("button", { name: "Sign reviewed registration", exact: true }).count(), 0, "Saved-ID inspection without proof offers no signing action");
      assert.equal(await prepareInline.count(), 0); assert.equal(sponsorPosts.length, 1); assert.equal(policies.length, count);
      assert.equal(await page.evaluate(() => (window as unknown as { typedSigns: unknown[] }).typedSigns.length), 0);
      await page.evaluate(address => (window as unknown as { setWallet: (address: string) => void }).setWallet(address), other);
      await savedRecovery.waitFor({ state: "hidden" });
      assert.equal(await page.getByLabel("Original request", { exact: true }).count(), 0, "Changing wallet fences the recovered original");
      // Restore the authoritative claim with both auth response orders. The
      // child's verified result must survive the parent's later session check.
      for (const order of ["child-first", "parent-first"] as const) {
        restoreAuthOrder = order; restoreSessionCalls = 0; heldRestoreAuth = undefined;
        await page.goto(preparedUrl);
        if (order === "child-first") await page.getByRole("heading", { name: "Source control verified", exact: true }).waitFor();
        else await page.getByRole("region", { name: "Saved registration recovery", exact: true }).waitFor();
        const restoredAuth = heldRestoreAuth as Route | undefined; assert(restoredAuth);
        await restoredAuth.fulfill({ json: { session: { address: sessionOwner, role: "asker" } } });
        restoreAuthOrder = null;
        await page.getByRole("button", { name: "Sign reviewed registration", exact: true }).waitFor();
        assert.equal(sponsorPosts.length, 1); assert.equal(await page.evaluate(() => (window as unknown as { typedSigns: unknown[] }).typedSigns.length), 0);
      }
      // A delayed claim cannot reopen registration after its wallet identity was
      // fenced, even when the parent session had already become authenticated.
      for (const fence of ["account", "network", "disconnect"] as const) {
        const capturedClaim = new Promise<Route>(resolve => { restoreClaimReady = resolve; }); holdRestoreClaim = true;
        const requested = page.waitForRequest(request => new URL(request.url()).pathname === "/api/source-claims" && new URL(request.url()).searchParams.has("claimId"));
        await page.goto(preparedUrl); await requested;
        const restoredClaim = await capturedClaim;
        await page.getByRole("region", { name: "Saved registration recovery", exact: true }).waitFor();
        await page.evaluate(({ address, chainId }) => (window as unknown as { setWallet: (address: string | undefined, chainId: number) => void }).setWallet(address, chainId),
          { address: fence === "disconnect" ? undefined : fence === "account" ? other : owner, chainId: fence === "network" ? profile.chainId + 1 : profile.chainId });
        if (fence === "account") await page.getByText(/This draft belongs to another wallet/).waitFor();
        else if (fence === "network") await page.getByText(/Switch your wallet to/).waitFor();
        else await page.getByRole("link", { name: "Connect and sign in to claim", exact: true }).waitFor();
        await restoredClaim.fulfill({ json: { claim: stored } });
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        assert.equal(await page.locator("#creator-register-title").count(), 0);
        assert.equal(await page.getByRole("button", { name: "Sign reviewed registration", exact: true }).count(), 0);
        assert.equal(sponsorPosts.length, 1); assert.equal(await page.evaluate(() => (window as unknown as { typedSigns: unknown[] }).typedSigns.length), 0);
      }
      await page.goto(preparedUrl); await page.getByRole("button", { name: "Sign reviewed registration", exact: true }).waitFor();
      assert.equal(sponsorPosts.length, 1, "Returning to the claim recovers the admitted original without a replacement hold");
      await page.getByRole("button", { name: "Sign reviewed registration", exact: true }).click();
      await page.getByText("Registration confirmed: indexing pending", { exact: true }).waitFor();
      const signed = await page.evaluate(() => (window as unknown as { typedSigns: Record<string, unknown>[] }).typedSigns);
      assert.equal(signed.length, 1); assert.equal(signed[0].account, owner);
      assert.deepEqual(signed[0].domain, { name: "KeryxSourceRegistry", version: "3", chainId: profile.chainId, verifyingContract: registry });
      assert.equal((signed[0].message as Record<string, unknown>).fetchPriceUsdc6, "5000"); assert.equal((signed[0].message as Record<string, unknown>).relayer, sponsor);
      assert.equal(await page.getByRole("heading", { name: "3. Choose how your source earns", exact: true }).count(), 0); assert.equal(policies.length, count);
      sponsorIndex = "mismatch"; await page.getByRole("button", { name: "Inspect original registration", exact: true }).click();
      assert.equal(await page.getByRole("heading", { name: "3. Choose how your source earns", exact: true }).count(), 0, "Wrong registry indexing cannot advance policy");
      sponsorIndex = "match"; await page.getByRole("button", { name: "Inspect original registration", exact: true }).click();
      await page.getByText("Registration confirmed and indexed", { exact: true }).waitFor();
      await page.getByRole("heading", { name: "3. Choose how your source earns", exact: true }).waitFor();
      assert.equal(await page.getByRole("heading", { name: "3. Choose and activate a policy", exact: true }).count(), 0, "Embedded policy does not duplicate the outer numbered step");
      await page.getByText(/Connected listing:/).waitFor(); assert.equal(links.length, 1, "Sponsor preparation already linked the authoritative claim; no manual relink");
      assert.equal(await page.locator("#claim-new-price").count(), 0, "Indexed policy uses the selected on-chain price instead of another price form");
      assert.equal(policies.length, count); await page.getByRole("radio", { name: /Paid reads/ }).check();
      const activateInline = page.getByRole("button", { name: "Activate paid reads", exact: true }); assert(await activateInline.isDisabled());
      await page.getByRole("checkbox", { name: /I have the rights to distribute/ }).check();
      await page.getByText("$0.005 USDC", { exact: true }).waitFor(); assert(!await activateInline.isDisabled());
      await activateInline.click(); await page.getByText(/This earning policy is saved/).waitFor(); assert.equal(policies.length, count + 1); assert.equal(stored!.mode, "paid");
      assert.equal(sponsorPosts.length, 2); assert.equal(await page.evaluate(() => (window as unknown as { walletWrites: unknown[] }).walletWrites.length), 0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Unified registration fits the viewport");
      await page.screenshot({ path: path.join(artifacts, `${profile.name}-${viewport.width}-unified-indexed-policy.png`), fullPage: true });
      const indexedUrl = page.url();
      const reloadResponses: { operation: string; status: number }[] = [];
      const observeReload = (response: Response) => {
        const pathname = new URL(response.url()).pathname;
        const operation = pathname === "/api/auth/session" ? "session" : pathname === "/api/source-claims" ? "claim" : pathname === "/api/sources/sponsor" ? "sponsor" : pathname.endsWith("/listing") ? "listing" : null;
        if (operation && reloadResponses.length < 32) reloadResponses.push({ operation, status: response.status() });
      };
      page.on("response", observeReload);
      try { await page.reload(); await page.getByText("Registration confirmed and indexed", { exact: true }).waitFor(); }
      catch (error) {
        console.error(JSON.stringify({ fixture: "public-source-claim-indexed-reload", profile: profile.name, viewport,
          sameIndexedUrl: page.url() === indexedUrl, authenticated, sessionOwnerMatches: sessionOwner === owner,
          sponsorIndex, originalState: (sponsorRow as SponsoredRegistration | null)?.state, sourceControlPresent: !!(stored as SourceClaim | null)?.verifiedAt,
          responseLimit: 32, reloadResponses, pageErrors: errors.slice(-4).map(message => message.slice(0, 160)),
          renderedState: await page.evaluate(() => ({
            connectedOwner: (window as unknown as { wallet: { address: string; isConnected: boolean } }).wallet.isConnected && (window as unknown as { wallet: { address: string } }).wallet.address === "0x1111111111111111111111111111111111111111",
            registrationStep: !!document.getElementById("creator-register-title"), policyStep: !!document.getElementById("creator-policy-title"),
            savedRecovery: !!document.querySelector('section[aria-label="Saved registration recovery"]'),
            claimHeading: document.getElementById("claim-verified-title")?.textContent?.slice(0, 80) ?? null,
            headings: Array.from(document.querySelectorAll("main h1, main h2, main h3")).slice(0, 12).map(node => node.textContent?.slice(0, 80) ?? ""),
          })).catch(() => ({ unavailable: true })),
        }));
        throw error;
      } finally { page.off("response", observeReload); }
      await page.getByText(/This earning policy is saved/).waitFor(); assert.equal(sponsorPosts.length, 2); assert.equal(policies.length, count + 1);
      assert.equal(await page.evaluate(() => (window as unknown as { typedSigns: unknown[] }).typedSigns.length), 0, "Reload inspects the same original without signing again");
      await page.goto("https://claim.test/register");
      await savedRecovery.locator("summary").click();
      await savedRecovery.getByLabel("Recover original request", { exact: true }).fill(preparedOriginalId);
      await savedRecovery.getByRole("button", { name: "Inspect saved request", exact: true }).click();
      await savedRecovery.getByText("Registration confirmed and indexed", { exact: true }).waitFor();
      assert.equal(await savedRecovery.getByRole("link", { name: `Original registration transaction: ${tx}`, exact: true }).getAttribute("href"), `${profile.explorerUrl}/tx/${tx}`);
      assert.equal(sponsorPosts.length, 2); assert.equal(policies.length, count + 1);
      assert.equal(await page.evaluate(() => (window as unknown as { typedSigns: unknown[] }).typedSigns.length), 0, "Receipt recovery is independent of proof and remains read-only");
      await page.goto(indexedUrl);
      try { await page.getByText("Registration confirmed and indexed", { exact: true }).waitFor(); }
      catch (error) {
        const restored = new URL(page.url());
        console.error(JSON.stringify({ fixture: "public-source-claim-indexed-revisit", profile: profile.name, viewport,
          sameIndexedUrl: page.url() === indexedUrl, registrationPath: restored.pathname === "/register",
          claimMatches: restored.searchParams.get("sourceClaimId") === claimId,
          ownerMatches: restored.searchParams.get("owner") === owner,
          chainMatches: restored.searchParams.get("chainId") === String(profile.chainId),
          rssMatches: restored.searchParams.get("rss") === expectedRss,
          walletFundedMode: restored.searchParams.get("mode") === "wallet-funded",
          authenticated, sessionOwnerMatches: sessionOwner === owner, sponsorIndex, originalState: sponsorRow?.state,
          sourceControlPresent: !!stored?.verifiedAt, pageErrors: errors.slice(-4),
          alerts: await page.getByRole("alert").allTextContents().catch(() => ["diagnostic unavailable"]),
          visibleStatus: await page.locator("main").innerText().then(text => text.slice(0, 1600)).catch(() => "diagnostic unavailable"),
        }));
        throw error;
      }
      const fallback = new URL((await page.getByRole("link", { name: "Wallet-funded registration ▸", exact: true }).getAttribute("href"))!, "https://claim.test");
      assert.equal(fallback.searchParams.get("mode"), "wallet-funded"); assert.equal(fallback.searchParams.get("fetchPrice"), "0.005"); assert.equal(fallback.searchParams.get("owner"), owner); assert.equal(fallback.searchParams.get("sourceClaimId"), claimId);
      await page.goto(fallback.toString()); await page.locator("#price").waitFor(); assert.equal(await page.locator("#price").inputValue(), "0.005"); assert.equal(await page.locator("#rss").inputValue(), expectedRss);
      const wrongNetwork = new URL(indexedUrl); wrongNetwork.searchParams.set("chainId", profile.testnet ? "5042" : "5042002");
      await page.goto(wrongNetwork.toString()); await page.getByText(/This draft belongs to another network/).waitFor(); assert.equal(await prepareInline.count(), 0);
      const wrongOwner = new URL(indexedUrl); wrongOwner.searchParams.set("owner", other);
      await page.goto(wrongOwner.toString()); await page.getByText(/This draft belongs to another wallet/).waitFor(); assert.equal(await prepareInline.count(), 0); assert.equal(sponsorPosts.length, 2);
      sponsorRow = null; stored = { ...stored!, linkedSourceId: undefined, onchainId: undefined, registryAddress: undefined }; sponsorAvailable = false;
      await page.goto(indexedUrl); await page.getByText("New sponsored registrations are paused because available gas funds are insufficient. Existing covered requests can still be completed within their reservation.", { exact: true }).waitFor();
      assert.equal(await prepareInline.count(), 0); assert.equal(sponsorPosts.length, 2); assert.equal(policies.length, count + 1);
      // A brand-new feed can also use channel metadata without editing its generated source URL.
      expectedCanonical = "https://another-publisher.example/channel.xml"; expectedRss = expectedCanonical;
      stored = null; challenge = null; sponsorAvailable = true; await page.evaluate(() => localStorage.clear());
      await page.goto(`https://claim.test/register?rss=${encodeURIComponent(expectedRss)}&fetchPrice=0.005&chainId=${profile.chainId}`);
      await page.getByRole("button", { name: "Create ownership proof", exact: true }).waitFor();
      assert.equal(await page.locator("#claim-source-url").inputValue(), expectedCanonical);
      await page.getByRole("radio", { name: "Publish a token in the RSS / Atom channel", exact: true }).check();
      await page.getByRole("button", { name: "Create ownership proof", exact: true }).click();
      await page.getByRole("heading", { name: "Publish your channel token", exact: true }).waitFor();
      assert.equal(challenge!.canonicalUrl, expectedRss); assert.equal(challenge!.rssUrl, expectedRss); assert.equal(challenge!.proofMethod, "rss-channel");
      await page.reload(); await page.getByRole("textbox", { name: "Channel proof token", exact: true }).waitFor();
      await page.getByRole("button", { name: "Check ownership", exact: true }).click(); await prepareInline.waitFor();
      assert.equal(await page.getByLabel("Price per read (USDC)", { exact: true }).inputValue(), "0.005");
      assert.equal(sponsorPosts.length, 2); assert.equal(policies.length, count + 1);
      assert.deepEqual(errors, []); await context.close();
      console.log(`PASS ${profile.name}/${viewport.width}px: one-page nonConzit verified publisher0.005 proof/sign-in/indexed original/explicit rights policy, same-original reload, safe wallet-funded fallback/funds exhausted, plus existing claim proof/renewal/wallet/network gates. All transport and wallet synthetic; no external publishing control or gas acceptance.`);
    }
  }
} finally { await browser.close(); }
