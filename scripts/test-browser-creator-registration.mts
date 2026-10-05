/** Real registration/feedback components; synthetic wallet, receipts and APIs only. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { circleSdkBrowserPlugin } from "./circle-sdk-browser-plugin.mts";
import { chromium } from "playwright";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../lib/arc-network-profile";
import { registrationId } from "../lib/sources/registration-status";
const creator = `0x${"a".repeat(40)}` as const, registry = `0x${"b".repeat(40)}` as const;
const urlHash = `0x${"c".repeat(64)}` as const, hash = `0x${"d".repeat(64)}` as const;
const sourceId = registrationId(creator, urlHash);
const event = [{ type: "event", name: "SourceRegistered", inputs: [
  { name: "id", type: "bytes32", indexed: true }, { name: "creator", type: "address", indexed: true },
  { name: "contentCid", type: "string", indexed: false },
] }] as const;
const log = { address: registry, topics: encodeEventTopics({ abi: event, eventName: "SourceRegistered", args: { id: sourceId, creator } }),
  data: encodeAbiParameters([{ type: "string" }], [""]) };
declare global { interface Window {
  registrationWrites: Record<string, unknown>[]; registrationChain: number; registrationCreated: number; registrationChainReads: number; registrationRpcChain: number;
  registrationInitialCreator?: string;
  setRegistrationWallet: (address: string) => void;
  registrationErrors: string[];
  registrationWriteError?: "reject" | "unknown";
  finishReceipt: (value: unknown) => void; failReceipt: () => void; registrationMount: (visible: boolean) => void;
} }
const browser = await chromium.launch({ headless: true });
try {
for (const profile of [ARC_TESTNET_PROFILE, ARC_MAINNET_PROFILE]) {
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {RegisterForm} from './components/keryx/register-form';
import {DecisionFeedbackPanel} from './app/creator/[id]/decision-feedback-panel';
window.registrationErrors=[];window.registrationWrites=[];window.registrationCreated=0;window.registrationChainReads=0;window.registrationRpcChain=${profile.chainId};window.registrationWriteError=undefined;
const initialCreator=window.registrationInitialCreator||'${creator}';
function Harness(){const [address,setAddress]=React.useState(initialCreator);window.registrationWallet=address;window.setRegistrationWallet=setAddress;const [visible,setVisible]=React.useState(true);window.registrationMount=setVisible;
return React.createElement(React.Fragment,null,visible&&React.createElement(RegisterForm,{prefillWalletAddress:initialCreator,onCreated:()=>window.registrationCreated++}),React.createElement(DecisionFeedbackPanel,{creatorId:'feedback'}));}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
` }, bundle: true, platform: "browser", format: "iife", jsx: "automatic", write: false,
  define: { "process.env.NEXT_PUBLIC_KERYX_NETWORK": JSON.stringify(profile.name), "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": JSON.stringify(registry), "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": JSON.stringify(registry), "process.env.NODE_ENV": '"development"' }, plugins: [circleSdkBrowserPlugin(), { name: "synthetic-registration", setup(b) {
    b.onResolve({ filter: /^next\/link$|^wagmi$|^sonner$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ resolveDir: process.cwd(), contents: a.path === "next/link" ? "import React from 'react';export default function Link(props){return React.createElement('a',props)}" : a.path === "wagmi" ? `
export const useAccount=()=>({address:window.registrationWallet,chainId:${profile.chainId}});
export const useSignMessage=()=>({signMessageAsync:async()=>{throw Error('Signatures forbidden in receipt harness');}});
export const useWriteContract=()=>({writeContractAsync:async args=>{if(window.registrationWriteError){const error=new Error('synthetic wallet error');if(window.registrationWriteError==='reject')error.cause={code:4001};throw error;}window.registrationWrites.push(JSON.parse(JSON.stringify(args,(_,v)=>typeof v==='bigint'?String(v):v)));return '${hash}';}});
const client={getChainId:async()=>{window.registrationChainReads++;return window.registrationRpcChain;},waitForTransactionReceipt:()=>new Promise((resolve,reject)=>{window.finishReceipt=resolve;window.failReceipt=()=>reject(new Error('synthetic RPC failure'));})};
export const usePublicClient=({chainId})=>{window.registrationChain=chainId;return client;};
` : a.path === "sonner" ? "export const toast=Object.fromEntries(['success','error','loading','dismiss'].map(kind=>[kind,(message)=>{if(kind==='error')window.registrationErrors.push(message);}]));" : "" }));
  } }] });
 const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
 let offline=false, indexMode="pending", posts=0, reads=0, verifiedId="";
 let holdPost: Promise<void> | undefined, observedPost: (()=>void) | undefined;
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/*",async route=>{
  const u=new URL(route.request().url());if(u.origin!=="https://registration.invalid")return route.abort();
  if(u.pathname==="/api/auth/session")return route.fulfill({json:{session:{address:creator,role:"creator"}}});
  if(u.pathname==="/api/sources") {posts++;observedPost?.();await holdPost;return route.fulfill({json:offline?{mode:"offline",source:{id:sourceId,name:"Fixture feed",walletAddress:creator,fetchPrice:.016,authors:[],verified:false},verification:{token:`keryx-verify:${creator}`,canVerify:true,instructions:"Place token in your feed"},notify:{url:"https://webhook.invalid",secret:"fixture-secret"}}:{mode:"onchain",sourceId,registryAddress:registry,registerParams:{urlHash,payoutWallet:creator,authors:[{wallet:creator,basisPoints:10000}],fetchPriceUsdc6:"16000",contentCid:"",tags:""},verification:{token:`keryx-verify:${creator}`,canVerify:true,instructions:"Place token in your feed"},notify:{url:"https://webhook.invalid",secret:"fixture-secret"}}});}
  if(u.pathname==="/api/sources/verify"){verifiedId=route.request().postDataJSON().sourceId;return route.fulfill({json:{verified:true}});}
  if(u.pathname.endsWith("/listing")){reads++;if(indexMode==="network")return route.abort();return route.fulfill({status:indexMode==="pending"?404:indexMode==="unavailable"?502:200,json:{mode:indexMode==="offline"?"offline":"onchain",onchainId:indexMode==="mismatch"?urlHash:sourceId,registryAddress:registry,creator}});}
  if(u.pathname.endsWith("/performance"))return route.fulfill({json:{windowRuns:3,performance:{considered:3,bought:2,reused:1,cited:1,citeThrough:1/3,skipped:0,recentSkips:[],rivalPriceOnSkip:null,price:.016}}});
  return route.fulfill({contentType:"text/html",body:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'});
 });
 async function fresh(initialCreator: string=creator){await page.goto("https://registration.invalid");await page.evaluate(value=>window.registrationInitialCreator=value,initialCreator);await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForTimeout(100);if(errors.length)throw new Error(errors.join(" | "));await page.locator("#rss").fill("https://feed.invalid/rss");}
 async function submit(){await page.getByRole("button",{name:/Publish source/}).click();await page.waitForFunction(()=>!!window.finishReceipt);}
 async function receipt(status="success",logs:unknown[]=[log],transactionHash=hash){await page.evaluate(value=>window.finishReceipt(value),{status,logs,transactionHash});}
 await fresh();await page.getByText("2 BUY",{exact:false}).waitFor();assert.equal(await page.getByText(/fresh tolls/).count(),0);
 // Atomic duplicate guard: two same-turn click events produce exactly one prepare/write.
 await page.getByRole("button",{name:/Publish source/}).evaluate(el=>{(el as HTMLButtonElement).click();(el as HTMLButtonElement).click();});
 await page.waitForFunction(()=>!!window.finishReceipt);assert.equal(posts,1);assert.equal((await page.evaluate(()=>window.registrationWrites)).length,1);assert.equal(await page.evaluate(()=>window.registrationChainReads),1);
 await page.getByText("Transaction submitted: confirmation pending",{exact:false}).waitFor();assert.equal(reads,0);
 assert(await page.getByRole("button",{name:"Register another source"}).isDisabled());
 await page.getByText(`keryx-verify:${creator}`,{exact:true}).waitFor();await page.getByText("fixture-secret",{exact:true}).waitFor();
 assert(await page.getByRole("button",{name:/Verify ownership/}).isDisabled());
 const write=(await page.evaluate(()=>window.registrationWrites))[0];assert.equal(write.account,creator);assert.equal(write.chainId,profile.chainId);assert.equal(await page.evaluate(()=>window.registrationChain),profile.chainId);
 // Repriced hash is accepted only when its receipt still proves the exact registration.
 const replacement=`0x${"e".repeat(64)}`;await receipt("success",[log],replacement);
 await page.getByText("Registration confirmed: indexing pending",{exact:false}).waitFor();assert.equal(await page.evaluate(()=>window.registrationCreated),0);
 for(const mode of ["mismatch","offline","unavailable"]){indexMode=mode;await page.getByRole("button",{name:"Check registration status"}).click();await page.getByText("Indexing is not yet confirmed.",{exact:false}).waitFor();assert.equal(await page.evaluate(()=>window.registrationCreated),0);}
 indexMode="match";await page.getByRole("button",{name:"Check registration status"}).click();await page.getByText("Registration confirmed and indexed:",{exact:false}).waitFor();assert.equal(await page.evaluate(()=>window.registrationCreated),1);assert(!(await page.getByRole("button",{name:/Verify ownership/}).isDisabled()));
 await page.getByRole("button",{name:/Verify ownership/}).click();await page.getByRole("button",{name:/Verify ownership/}).waitFor({state:"hidden"});assert.equal(verifiedId,sourceId);
 assert.equal(await page.getByRole("link",{name:"View on ArcScan"}).getAttribute("href"),`${profile.explorerUrl}/tx/${replacement}`);
 // The wallet's declared rail cannot substitute for the actual public-client chain.
 await fresh();await page.evaluate(chainId=>{window.registrationRpcChain=chainId;},profile.chainId===5042?5042002:5042);await page.getByRole("button",{name:/Publish source/}).click();
 await page.getByText("Registration RPC network changed",{exact:false}).waitFor();
 assert.equal(await page.evaluate(()=>window.registrationChainReads),1);assert.equal((await page.evaluate(()=>window.registrationWrites)).length,0);
 for(const [status,logs] of [["reverted",[log]],["success",[]],["success",[{...log,address:creator}]],["success",[{...log,topics:encodeEventTopics({abi:event,eventName:"SourceRegistered",args:{id:urlHash,creator}})}]],["success",[{...log,topics:encodeEventTopics({abi:event,eventName:"SourceRegistered",args:{id:sourceId,creator:registry}})}]]] as const){
  await fresh();const before=reads;await submit();await receipt(status,[...logs]);await page.getByText("Registration not confirmed:",{exact:false}).waitFor();assert.equal(reads,before);assert.equal(await page.evaluate(()=>window.registrationCreated),0);
 }
 await fresh();await submit();await page.evaluate(()=>window.failReceipt());await page.getByText("Confirmation unknown:",{exact:false}).waitFor();assert(await page.getByRole("button",{name:"Register another source"}).isDisabled());
 const prepared=posts;await page.getByRole("button",{name:"Check registration status"}).click();await page.waitForFunction(()=>!!window.finishReceipt);await receipt();await page.getByText("Registration confirmed and indexed:",{exact:false}).waitFor();assert.equal(posts,prepared);
 for(const failure of ["reject","unknown"] as const){
  await fresh();await page.evaluate(value=>{window.registrationWriteError=value},failure);await page.getByRole("button",{name:/Publish source/}).click();
  await page.getByText(failure==="reject"?"Registration not confirmed:":"Confirmation unknown:",{exact:false}).waitFor();
  await page.getByText("fixture-secret",{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.registrationCreated),0);
  assert.equal(await page.getByRole("button",{name:"Register another source"}).isDisabled(),failure==="unknown");
 }
 // A wallet switched BEFORE preparation may match prefill while the SIWE session still owns A.
 // Server payout A versus connected/prefill B must fail before opening any wallet request.
 await fresh(registry);await page.getByRole("button",{name:/Publish source/}).click();
 await page.getByText("Sign in again with the connected creator wallet.",{exact:false}).waitFor();
 assert.equal((await page.evaluate(()=>window.registrationWrites)).length,0);assert.equal(await page.evaluate(()=>window.registrationCreated),0);
 await page.getByText(`keryx-verify:${creator}`,{exact:true}).waitFor();await page.getByText("fixture-secret",{exact:true}).waitFor();
 // A wallet change while preparation is in flight must never sign for the original session.
 await fresh();let releaseWallet!:()=>void;holdPost=new Promise(resolve=>{releaseWallet=resolve});const sawWalletPost=new Promise<void>(resolve=>{observedPost=resolve});
 await page.getByRole("button",{name:/Publish source/}).click();await sawWalletPost;await page.evaluate(value=>window.setRegistrationWallet(value),registry);releaseWallet();holdPost=undefined;observedPost=undefined;
 await page.getByText("Registration not confirmed:",{exact:false}).waitFor();assert.equal((await page.evaluate(()=>window.registrationWrites)).length,0);
 // A late prepare response cannot open the wallet after the form unmounts.
 await fresh();let releasePost!:()=>void;holdPost=new Promise(resolve=>{releasePost=resolve});const sawPost=new Promise<void>(resolve=>{observedPost=resolve});
 await page.getByRole("button",{name:/Publish source/}).click();await sawPost;await page.evaluate(()=>window.registrationMount(false));releasePost();holdPost=undefined;observedPost=undefined;await page.waitForTimeout(100);assert.equal((await page.evaluate(()=>window.registrationWrites)).length,0);
 // A completion from an unmounted attempt must not update a newly mounted form.
 await fresh();await submit();await page.evaluate(()=>{const old=window.finishReceipt;window.registrationMount(false);setTimeout(()=>{window.registrationMount(true);setTimeout(()=>old({status:'success',logs:[],transactionHash:'${hash}'}),20);},20);});
 await page.getByRole("button",{name:/Publish source/}).waitFor();assert.equal(await page.evaluate(()=>window.registrationCreated),0);
 offline=true;await fresh();await page.getByRole("button",{name:/Publish source/}).click();
 if(profile.testnet){await page.getByText("Source saved locally (offline):",{exact:false}).waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent?.includes('Verify ownership')&&!button.disabled));}
 else {await page.waitForFunction(()=>window.registrationErrors.includes("Mainnet registration requires confirmed on-chain authority"));assert.equal(await page.getByRole("button",{name:/Verify ownership/}).count(),0);}
 assert.equal((await page.evaluate(()=>window.registrationWrites)).length,0);if(profile.testnet)await page.getByText("fixture-secret",{exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 await page.close();
}
 console.log("PASS: selected-profile testnet/mainnet registration; registration receipt/event/index gates, repricing/cancellation/mismatch/revert/unknown, duplicate/stale guards, offline proof and one-time secret; decision counts do not imply settlement. Synthetic only.");
}finally{await browser.close();}
