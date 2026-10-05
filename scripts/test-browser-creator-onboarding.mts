/** Real register/connect/portfolio React flow. Synthetic wallet/auth/API; every request intercepted. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { circleSdkBrowserPlugin } from "./circle-sdk-browser-plugin.mts";
import { chromium, type Route } from "playwright";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../lib/arc-network-profile";
import { registrationId } from "../lib/sources/registration-status";

const wallet = `0x${"1".repeat(40)}`, other = `0x${"2".repeat(40)}`;
const rss = "https://publisher.example/feed.xml", post = "https://publisher.example/post", gap = "gap-123";
const registeredUrlHash = `0x${"3".repeat(64)}` as const;
const registeredId = registrationId(wallet, registeredUrlHash), txHash = `0x${"4".repeat(64)}`;
const receipt = { status: "success", transactionHash: txHash, logs: [{ address: other,
  topics: encodeEventTopics({abi:[{type:"event",name:"SourceRegistered",inputs:[{name:"id",type:"bytes32",indexed:true},{name:"creator",type:"address",indexed:true},{name:"contentCid",type:"string",indexed:false}]}],eventName:"SourceRegistered",args:{id:registeredId,creator:wallet}}),data:encodeAbiParameters([{type:"string"}],[""])}] };
const browser = await chromium.launch({ headless: true });
try {
for (const profile of [ARC_TESTNET_PROFILE, ARC_MAINNET_PROFILE]) {
const bundle = await build({ stdin: { contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import RegisterPage from './app/register/page';import ConnectPage from './app/connect/page';
import {MySourcesView} from './app/me/sources/my-sources-view';
import {OwnerFeedVerification} from './components/keryx/owner-feed-verification';
window.wallet={address:sessionStorage.getItem('wallet')||'${wallet}',isConnected:true,chainId:${profile.chainId}};
window.switchWallet=()=>{window.wallet={...window.wallet,address:'${other}'};sessionStorage.setItem('wallet','${other}');window.dispatchEvent(new Event('wallet-change'));};
createRoot(document.getElementById('root')).render(location.pathname==='/register'?<RegisterPage/>:location.pathname==='/connect'?<ConnectPage/>:location.pathname==='/creator/persisted'?<OwnerFeedVerification sourceId="persisted"/>:<MySourcesView/>);
`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife",
  define: { "process.env": "{}", "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": JSON.stringify(profile.name), "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": JSON.stringify(other), "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": JSON.stringify(other) },
  plugins: [circleSdkBrowserPlugin(), { name: "synthetic-boundaries", setup(b) {
    b.onResolve({ filter: /^(wagmi|sonner|next\/link)$/ }, args => ({ path: args.path, namespace: "synthetic" }));
    b.onResolve({ filter: /(site-header|bulk-import-form|claim-onchain-panel|faucet-panel|withdraw-earnings-panel|sources-list|account-sessions|wallet-picker|chain-banner)$/ }, args => ({ path: args.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ loader: "jsx", contents: `export const SiteHeader=()=>null,BulkImportForm=()=>null,ClaimOnchainPanel=()=>null,FaucetPanel=()=>null,WithdrawEarningsPanel=()=>null,SourcesList=()=>null,AccountSessions=()=>null,WalletPicker=()=>null,ChainBanner=()=>null;` }));
    b.onLoad({ filter: /.*/, namespace: "synthetic" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents:
      args.path === 'wagmi' ? `import{useSyncExternalStore}from'react';const subscribe=fn=>{window.addEventListener('wallet-change',fn);return()=>window.removeEventListener('wallet-change',fn)};export const useConnect=()=>({connectors:[],isPending:false,connectAsync:async()=>{throw Error("Unexpected Google connector in external-wallet fixture")}});export const useAccount=()=>useSyncExternalStore(subscribe,()=>window.wallet);export const useChainId=()=>useAccount().chainId;export const useSwitchChain=()=>({isPending:false,switchChain:({chainId})=>{window.wallet={...window.wallet,chainId};window.dispatchEvent(new Event('wallet-change'));}});export const useSignMessage=()=>({signMessageAsync:async()=> 'synthetic-signature'});export const useWriteContract=()=>({writeContractAsync:async()=> '${txHash}'});export const usePublicClient=()=>({getChainId:async()=>${profile.chainId},waitForTransactionReceipt:async()=>(${JSON.stringify(receipt)})});export const useDisconnect=()=>({disconnect:()=>{},disconnectAsync:async()=>{}});`
      : args.path === 'sonner' ? `export const toast=()=>{};toast.success=toast;toast.error=toast;toast.loading=toast;toast.dismiss=toast;`
      : `import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}` }));
  } }] });
const html = `<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`;
  for (const role of ["asker", "creator"]) {
    const context = await browser.newContext();
    let authenticated = false, failSignIn = true, verified = false, verificationState = "missing";
    let registrationCalls = 0, verificationCalls = 0, signInCalls = 0, sessionAddress = wallet;
    let heldVerification: Route | undefined;
    const bodies: Record<string, unknown>[] = [], errors: string[] = [];
    await context.route("**/*", async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path === '/api/auth/session') return route.fulfill({ status: authenticated ? 200 : 401, json: { session: authenticated ? { address: sessionAddress, role } : null } });
      if (path === '/api/auth/nonce') { const now=Date.now(); return route.fulfill({ json: { nonce:'SyntheticNonce123',issuedAt:new Date(now).toISOString(),challengeExpiresAt:new Date(now+300000).toISOString(),sessionExpiresAt:new Date(now+7*86400000).toISOString() } }); }
      if (path === '/api/auth/verify') {
        signInCalls++;assert.match(req.postDataJSON().message, new RegExp(`Chain ID: ${profile.chainId}(?:\\n|$)`));
        if (failSignIn) return route.fulfill({ status: 401, json: { error: 'Synthetic sign-in failure' } });
        authenticated = true; return route.fulfill({ json: { ok: true, created: role === 'asker', address: wallet, role } });
      }
      if (path === '/api/sources') {
        if (req.method() === 'GET') return route.fulfill({ json: { sources: [] } });
        assert.equal(req.method(),'POST'); registrationCalls++; bodies.push(req.postDataJSON());
        if(!profile.testnet)return route.fulfill({json:{mode:'onchain',sourceId:registeredId,registryAddress:other,registerParams:{urlHash:registeredUrlHash,payoutWallet:wallet,authors:[{wallet,basisPoints:10000}],fetchPriceUsdc6:'16000',contentCid:'',tags:''},verification:{token:`keryx-verify:${wallet}`,canVerify:true,instructions:'Publish token'}}});
        return route.fulfill({ json: { mode:'offline', source:{ id:'persisted',name:'Synthetic publisher',walletAddress:wallet,verified:false,fetchPrice:0.016,authors:[] }, verification:{ token:`keryx-verify:${wallet}`,canVerify:true,instructions:'Publish token' } } });
      }
      if(path.endsWith('/listing'))return route.fulfill({json:{mode:'onchain',onchainId:registeredId,registryAddress:other,creator:wallet}});
      if (path === '/api/me/sources') return route.fulfill({ json: { wallet, emailEnabled:false,sources:[{ id:'persisted',name:'Synthetic publisher',active:true,verified,hasFeed:true,earnedUsdc:0,citationCount:0,email:null,webhookConfigured:false,verificationSource:{ id:'persisted',walletAddress:wallet,rssUrl:rss,verified } }] } });
      if (path === '/api/me/listings') return route.fulfill({ json: { listings:[], nextCursor:null, uncertain:0 } });
      if (path === '/api/sources/verify') {
        if (req.method() === 'GET') return route.fulfill({ json: { source:{id:'persisted',walletAddress:wallet,rssUrl:rss,verified} } });
        verificationCalls++; assert.deepEqual(req.postDataJSON(), {sourceId:'persisted'});
        if (sessionAddress!==wallet) return route.fulfill({status:403,json:{error:'not the source payout wallet'}});
        if (verificationState==='held') { heldVerification=route;return; }
        if (verificationState === 'unavailable') return route.fulfill({ status:502,json:{error:'The feed could not be read. Check its availability and retry; ownership has not been verified.',code:'feed_unavailable',verified:false} });
        if (verificationState === 'not-indexed') return route.fulfill({ status:404,json:{error:'source not found'} });
        if (verificationState === 'missing') return route.fulfill({json:{verified:false,message:'Token not found in the feed yet. Publish the exact token, then retry.'}});
        verified = true; return route.fulfill({json:{verified:true}});
      }
      assert.equal(req.method(),'GET',`Unexpected request: ${req.method()} ${path}`);
      assert(!path.startsWith('/api/'), `Unexpected API: ${path}`);
      return route.fulfill({contentType:'text/html',body:html});
    });
    const page = await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    const largeDescription = String.fromCharCode(0x4e2d).repeat(2000);
    await page.goto(`https://creator.test/register?${new URLSearchParams({ rss, gap, post, name: 'Publisher', desc: largeDescription })}`);
    await page.getByText(/This draft is too large to carry through sign-in safely/).waitFor();
    assert.equal(await page.getByRole('link',{name:'Sign in ▸',exact:true}).count(),0);
    await page.getByRole('button',{name:'Keep feed and Wanted match; remove optional prefill'}).click();
    const boundedLink = page.getByRole('link',{name:'Sign in ▸',exact:true});await boundedLink.waitFor();
    assert((await boundedLink.getAttribute('href'))!.length <= 6000);
    assert.equal(new URL(page.url()).searchParams.get('rss'),rss);
    assert.equal(new URL(page.url()).searchParams.get('gap'),gap);
    assert.equal(new URL(page.url()).searchParams.get('post'),post);
    assert.equal(new URL(page.url()).searchParams.get('desc'),null);
    await page.goto('https://creator.test/register');
    await page.waitForTimeout(300);assert.deepEqual(errors,[]);
    await page.getByRole('textbox',{name:'Your RSS feed URL'}).fill(rss);
    await page.getByRole('button',{name:'Prepare feed',exact:true}).click();
    assert.equal(new URL(page.url()).searchParams.get('rss'),rss);
    await page.reload(); await page.getByText(`Ready to register: ${rss}.`,{exact:false}).waitFor();
    await page.getByRole('link',{name:'Sign in ▸',exact:true}).click();
    await page.evaluate(chainId=>{const w=window as unknown as {wallet:Record<string,unknown>};w.wallet={...w.wallet,chainId};window.dispatchEvent(new Event('wallet-change'));},profile.chainId===5042?5042002:5042);
    await page.getByText(`Keryx runs on ${profile.label} (chainId ${profile.chainId}). Switch to continue.`).waitFor();
    assert(await page.getByRole('button',{name:'Sign in with Ethereum ▸'}).isDisabled());assert.equal(signInCalls,0);
    await page.getByRole('button',{name:'Switch ▸',exact:true}).click();
    await page.getByRole('button',{name:'Sign in with Ethereum ▸'}).click();
    await page.getByRole('button',{name:'Sign in with Ethereum ▸'}).waitFor();
    assert.equal(registrationCalls,0);assert.equal(await page.getByRole('link',{name:'Resume source registration'}).count(),0);
    await page.reload(); failSignIn = false;
    await page.getByRole('button',{name:'Sign in with Ethereum ▸'}).click();
    await page.getByRole('link',{name:'Resume source registration'}).click();
    await page.locator('#rss').waitFor();assert.equal(await page.locator('#rss').inputValue(),rss);
    assert.equal(registrationCalls,0);
    // Wanted normal forward path includes its matched post in the actual registration request.
    authenticated = false;
    await page.goto(`https://creator.test/register?rss=${encodeURIComponent(rss)}&gap=${gap}&post=${encodeURIComponent(post)}`);
    await page.getByRole('link',{name:'Sign in ▸',exact:true}).click();
    await page.getByRole('button',{name:'Sign in with Ethereum ▸'}).click();
    await page.getByRole('link',{name:'Resume source registration'}).click();
    await page.getByRole('button',{name:'Publish source ▸'}).click();
    await page.getByRole('heading',{name:'Verify feed ownership',exact:true}).waitFor();
    if(!profile.testnet)await page.getByText('Registration confirmed and indexed:',{exact:false}).waitFor();
    assert.equal(registrationCalls,1);assert.deepEqual(bodies[0],{walletAddress:wallet,gapId:gap,matchedItemLink:post,rssUrl:rss,fetchPrice:0.016});
    await page.goto('https://creator.test/me/sources');await page.reload();
    await page.getByText(`keryx-verify:${wallet}`,{exact:true}).waitFor();
    await page.getByRole('button',{name:'Verify ownership'}).click();await page.getByText(/Token not found in the feed yet/).waitFor();
    verificationState='unavailable';await page.getByRole('button',{name:'Verify ownership'}).click();await page.getByText(/The feed could not be read/).waitFor();
    verificationState='not-indexed';await page.getByRole('button',{name:'Verify ownership'}).click();await page.getByText(/not available in the index/).waitFor();
    // A second fresh browser can inspect the existing persisted proof on Manage.
    const second = await browser.newContext();await second.route('**/*',async route=> {
      const path = new URL(route.request().url()).pathname;
      if(path==='/api/auth/session')return route.fulfill({json:{session:{address:wallet,role}}});
      if(path==='/api/sources/verify' && route.request().method()==='GET')return route.fulfill({json:{source:{id:'persisted',walletAddress:wallet,rssUrl:rss,verified:false}}});
      assert.equal(route.request().method(),'GET');return route.fulfill({contentType:'text/html',body:html});
    });
    const secondPage=await second.newPage();await secondPage.goto('https://creator.test/creator/persisted');await secondPage.getByText(`keryx-verify:${wallet}`,{exact:true}).waitFor();await second.close();
    verificationState='present';await page.getByRole('button',{name:'Verify ownership'}).click();await page.getByText('unverified — off the money path').waitFor({state:'hidden'});
    await page.reload();await page.getByText('Synthetic publisher',{exact:true}).first().waitFor();assert.equal(await page.getByRole('button',{name:'Verify ownership'}).count(),0);
    assert.equal(registrationCalls,1);assert.equal(verificationCalls,4);
    // A delayed old-owner success cannot update management after signing into another account.
    verified=false;verificationState='held';await page.reload();
    await page.getByRole('button',{name:'Verify ownership',exact:true}).click();
    await page.waitForFunction(()=>document.body.textContent?.includes('Checking feed...'));
    assert(heldVerification);sessionAddress=other;
    await page.evaluate(()=>window.dispatchEvent(new Event('keryx:auth')));
    await page.getByText(/Sign in with this source.s payout wallet/).waitFor();
    await heldVerification.fulfill({json:{verified:true}});
    await page.getByRole('button',{name:'Verify ownership',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Verify ownership',exact:true}).isDisabled(),true);
    await page.getByText('unverified '+String.fromCharCode(0x2014)+' off the money path',{exact:true}).waitFor();
    sessionAddress=wallet;
    await page.goto('https://creator.test/connect');
    // Direct /connect still follows the role default; malicious targets cannot change it.
    for(const target of ['', '//evil.example/register', '/register\\@evil.example', '/register%3fnext=//evil.example', '/register\n?rss=bad']) {
      await page.goto(`https://creator.test/connect${target?'?returnTo='+encodeURIComponent(target):''}`);
      const cta=page.getByRole('link',{name:role==='asker'?'Ask a question ▸':'Issue a toll ▸',exact:true});await cta.waitFor();assert.equal(await cta.getAttribute('href'),role==='asker'?'/':'/register');
    }
    // Draft wallet binding survives switch/reload, and cookie-wallet mismatch cannot mount a form.
    await page.goto(`https://creator.test/connect?returnTo=${encodeURIComponent('/register?rss='+encodeURIComponent(rss))}`);
    await page.getByRole('link',{name:'Resume source registration'}).waitFor();
    await page.evaluate(()=> (window as unknown as {switchWallet:()=>void}).switchWallet());
    await page.getByRole('button',{name:'Sign in with Ethereum ▸'}).waitFor();
    await page.reload();await page.getByRole('button',{name:'Sign in with Ethereum ▸'}).waitFor();
    await page.goto(`https://creator.test/register?rss=${encodeURIComponent(rss)}&owner=${wallet}`);
    await page.getByText('Confirm your payout wallet',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Publish source ▸'}).count(),0);
    assert.equal(registrationCalls,1);
    sessionAddress=other;await page.reload();
    await page.getByText(/This draft was prepared for/).waitFor();
    assert.equal(await page.getByRole('button',{name:/Publish source/}).count(),0);
    await page.goto(`https://creator.test/connect?returnTo=${encodeURIComponent('/register?rss='+encodeURIComponent(rss)+'&owner='+wallet)}`);
    await page.getByText(/This registration draft belongs to the wallet/).waitFor();
    assert.equal(await page.getByRole('link',{name:'Resume source registration'}).count(),0);
    assert.deepEqual(errors,[]);await context.close();
  }
}
  console.log('PASS: selected-profile testnet/mainnet SIWE chain and wrong-chain guard; prepared and Wanted forward sign-in for asker/creator, failure/reload/switch safety, safe defaults, returning proof across reload/new browser, distinct retry states and persisted success. All auth/wallet/API synthetic; no network, registry transaction, payment or real listing.');
} finally { await browser.close(); }
