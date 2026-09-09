import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
const bundle = await build({ stdin: { contents: `import * as commitment from './lib/buyer/private-request-commitment';window.commitment=commitment;`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "browser", format: "iife" });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage(); let requests = 0;
  await page.route("**/*", route => { requests++; assert.equal(route.request().method(), "GET"); return route.fulfill({ contentType: "text/html", body: "<main>Commitment fixture</main>" }); });
  await page.goto("https://commitment.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(`(async () => {
    const request={question:'What evidence supports this claim?',budget:0.03,researchMode:'deep',packageVersion:'1.0.0',responseMode:'async',access:'payer-private-v1',model:null};
    const payer='0x'+'1'.repeat(40),payee='0x'+'2'.repeat(40);
    const requirement={scheme:'exact',network:'eip155:5042002',asset:'0x3600000000000000000000000000000000000000',amount:'50000',payTo:payee,maxTimeoutSeconds:604860,extra:{name:'GatewayWalletBatched',version:'1',verifyingContract:'0x0077777d7EBA4688BDeF3E311b846F25870A19B9'}};
    const terms={from:payer,to:payee,value:'50000',validAfter:'1788911400',validBefore:'1789516860'};
    const nonce=await window.commitment.privateRequestNonce(request,requirement,terms,'0x'+'3'.repeat(64));
    const first=await window.commitment.createPrivateAuthorization(request,requirement,payer,{privatePayee:payee,publicResearchPayee:payer},1788912000000);
    const second=await window.commitment.createPrivateAuthorization(request,requirement,payer,{privatePayee:payee,publicResearchPayee:payer},1788912000000);
    let collisionDenied=false;
    try { await window.commitment.createPrivateAuthorization(request,requirement,payer,{privatePayee:payee,publicResearchPayee:payee},1788912000000); }
    catch { collisionDenied=true; }
    return {nonce,collisionDenied,fresh:first.salt!==second.salt&&first.authorization.nonce!==second.authorization.nonce,
      valid:await window.commitment.matchesPrivateRequestCommitment(first.request,requirement,first.authorization,first.salt),
      changed:await window.commitment.matchesPrivateRequestCommitment({...first.request,question:'Changed'},requirement,first.authorization,first.salt)};
  })()`);
  assert.equal(result.nonce, "0x4f81a6cb31fd90eb1584353253aa81f135a3cd553f9c0402d4aafa8db4ef6421");
  assert.equal(result.fresh, true); assert.equal(result.valid, true); assert.equal(result.changed, false); assert.equal(result.collisionDenied, true); assert.equal(requests, 1);
  console.log("PASS: Chromium and Node commitment vector agrees; randomness, tamper rejection and merchant separation verified. No wallet, signing or payment requests.");
} finally { await browser.close(); }
