import { expect, it } from "vitest";
import { build } from "esbuild";
import { chromium } from "playwright";
/** Real IndexedDB commits across tabs, not a memory transaction substitute. */
it("fences concurrent payment/withdrawal, retains exposed barriers and releases only original outcomes", async()=>{
  const bundle=await build({stdin:{contents:`import * as storage from './lib/session/browser-session-withdrawal-storage';
    import {reserveBrowserSessionAuthorization as pay} from './lib/session/browser-session-capacity';
    Object.assign(window,{storage,pay});`,resolveDir:process.cwd()},bundle:true,write:false,platform:"browser",format:"esm"});
  const browser=await chromium.launch({headless:true});
  try{const context=await browser.newContext();
    await context.route("https://keryx.cc/**",route=>route.fulfill({contentType:"text/html",body:`<script type="module">${bundle.outputFiles[0].text}</script>`}));
    const first=await context.newPage(),second=await context.newPage(); await Promise.all([first.goto("https://keryx.cc"),second.goto("https://keryx.cc")]);
    const result=await first.evaluate(async()=>{
      const {storage,pay}=window as unknown as {storage:typeof import("./browser-session-withdrawal-storage");pay:typeof import("./browser-session-capacity").reserveBrowserSessionAuthorization};
      const namespace="test-cashout-cross-tab",epoch="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",id=`0x${"44".repeat(32)}`;
      const packet={requestId:id,grantEpoch:epoch,burnIntent:{spec:{value:"5"}}} as import("../gateway/session-withdrawal-protocol").SessionWithdrawalPreparation;
      const before=await storage.readBrowserSessionExposure(namespace);
      await pay(namespace,epoch,`0x${"11".repeat(32)}`,BigInt(5),BigInt(10));
      let raceRefused=false;try{await storage.reserveBrowserSessionWithdrawal(namespace,packet,before.version)}catch{raceRefused=true}
      const current=await storage.readBrowserSessionExposure(namespace);
      await storage.reserveBrowserSessionWithdrawal(namespace,packet,current.version);
      return {namespace,epoch,id,raceRefused,version:current.version};
    });
    expect(result.raceRefused).toBe(true);expect(result.version).toBe("1");
    const other=await second.evaluate(async({namespace,epoch,id})=>{
      const {storage,pay}=window as unknown as {storage:typeof import("./browser-session-withdrawal-storage");pay:typeof import("./browser-session-capacity").reserveBrowserSessionAuthorization};
      const packet={requestId:id,grantEpoch:epoch,burnIntent:{spec:{value:"5"}}} as import("../gateway/session-withdrawal-protocol").SessionWithdrawalPreparation;
      let paymentRefused=false;try{await pay(namespace,epoch,`0x${"22".repeat(32)}`,BigInt(1),BigInt(10))}catch{paymentRefused=true}
      await storage.retainBrowserSessionWithdrawalOutcome(namespace,packet,{exposed:true});
      await storage.retainBrowserSessionWithdrawalOutcome(namespace,packet,{signature:"retained-test-signature"});
      const mint={to:`0x${"66".repeat(20)}`,data:"0xabcd",value:"0" as const,nonce:2,gas:"300000",maxFeePerGas:"1",maxPriorityFeePerGas:"1"};
      if(!await storage.claimBrowserSessionWithdrawalDelivery(namespace,packet,{mint}))throw new Error("Original owner mint unavailable");
      await storage.retainBrowserSessionOwnerMintHash(namespace,packet,`0x${"77".repeat(32)}`);
      if(await storage.claimBrowserSessionWithdrawalDelivery(namespace,packet,{mint}))throw new Error("Duplicate mint admitted");
      let cancellationRefused=false;try{await storage.cancelUnexposedBrowserWithdrawal(namespace,packet)}catch{cancellationRefused=true}
      return {paymentRefused,cancellationRefused};
    },result);
    expect(other).toEqual({paymentRefused:true,cancellationRefused:true});await first.close();
    const final=await second.evaluate(async({namespace,epoch,id})=>{
      const {storage,pay}=window as unknown as {storage:typeof import("./browser-session-withdrawal-storage");pay:typeof import("./browser-session-capacity").reserveBrowserSessionAuthorization};
      const packet={requestId:id,grantEpoch:epoch,burnIntent:{spec:{value:"5"}}} as import("../gateway/session-withdrawal-protocol").SessionWithdrawalPreparation;
      const retained=await storage.readBrowserSessionWithdrawal(namespace,id);
      const references=await storage.listBrowserSessionWithdrawalReferences(namespace);
      // This primitive receives only the completion already verified by runtime/RPC admission.
      await storage.retainBrowserSessionWithdrawalOutcome(namespace,packet,{completion:{verifiedOriginal:true}});
      await pay(namespace,epoch,`0x${"33".repeat(32)}`,BigInt(5),BigInt(10));
      let exhausted=false;try{await pay(namespace,epoch,`0x${"55".repeat(32)}`,BigInt(1),BigInt(10))}catch{exhausted=true}
      const exposure=await storage.readBrowserSessionExposure(namespace);let oldIdRefused=false;
      try{await storage.reserveBrowserSessionWithdrawal(namespace,packet,exposure.version)}catch{oldIdRefused=true}
      return {retained:retained?.exposed,mintNonce:retained?.mint?.nonce,mintHash:references[0]?.mintHash,
        publicReferenceHasSignature:"signature" in references[0],exhausted,oldIdRefused,count:exposure.authorizations.length,barrier:exposure.withdrawal};
    },result);
    expect(final).toEqual({retained:true,mintNonce:2,mintHash:`0x${"77".repeat(32)}`,publicReferenceHasSignature:false,
      exhausted:true,oldIdRefused:true,count:2,barrier:null});
  }finally{await browser.close()}
},30000);
