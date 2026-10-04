/** Browser behavior for stored evidence, payment truth, dialog focus and log following. */
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

const buildDir = path.resolve(process.cwd(), process.env.NEXT_DIST_DIR ?? ".next");
const cssDir = [
  path.join(buildDir, "static", "chunks"),
  path.join(buildDir, "dev", "static", "chunks"),
].find(dir => existsSync(dir) && readdirSync(dir).some(name => name.endsWith(".css")));
const cssFiles = cssDir
  ? readdirSync(cssDir).filter(name => name.endsWith(".css")).map(name => path.join(cssDir, name))
  : [];
const stylesheet = cssFiles.map(file => readFileSync(file, "utf8")).join("\n");
if (!stylesheet.includes(".bg-paper") || !stylesheet.includes(".sm\\:w-")) {
  throw new Error("Generated Tailwind stylesheet missing or stale; build before styled reading test");
}

const bundle = await build({
  stdin: {
    contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AnswerCard } from './components/keryx/answer-card';
import { ReasoningConsole } from './components/keryx/reasoning-console';
import { DispatchView } from './app/dispatch/[id]/dispatch-view';
import { buildEvidenceLedger } from './lib/agent/evidence-ledger';
import { finalizeGroundedAnswer } from './lib/agent/answer-grounding';
const citation = {marker:'S1', sourceId:'source-1', sourceName:'Research Journal', itemId:'article-1', itemTitle:'The article: an unusually long title about measured evidence and a disputed claim across several research teams', itemUrl:'https://example.org/article', weight:1, reward:0.003, rationale:'evidence'};
const missing = {marker:'S2',sourceId:'source-2',sourceName:'Older Archive',itemTitle:'Legacy article',weight:0, reward:0, rationale:'legacy'};
const web = {marker:'S3',sourceId:'public:web:fixture',sourceName:'publisher.example',itemTitle:'Original public document',itemUrl:'https://publisher.example/final',contentVersion:'a'.repeat(64),sourceKind:'public-reference',publicDeliveryKind:'excerpt',weight:0,reward:0,rationale:'public evidence',webProvenance:{retrievedAt:'2026-10-01T00:00:00Z',publisherGroup:'publisher.example',normalizedBodyHash:'b'.repeat(64),extraction:'pdf',truncated:true}};
const scholarly = {...web, marker:'S4', sourceId:'public:scholarly:fixture',sourceName:'arxiv.org',itemTitle:'Observed scholarly preprint',itemUrl:'https://arxiv.org/abs/1706.03762v7',publicDeliveryKind:'abstract',webProvenance:{...web.webProvenance,extraction:'html',publisherGroup:'arxiv.org',truncated:false},scholarly:{provider:'arxiv',recordUrl:'https://export.arxiv.org/api/query?id_list=1706.03762v7',retrievedAt:'2026-10-01T00:00:00Z',title:'Observed scholarly preprint',authors:['Observed Author'],arxivId:'1706.03762v7',workType:'preprint',peerReview:'unknown',evidenceScope:'abstract-page'}};
const trace = Array.from({length:40},(_,i)=>({phase:'discover',ts:i,message:'Step '+i}));
const run = {id:'synthetic',question:'What happened to a particularly long research question that needs a careful cited explanation?',budget:0.01,engine:'fixture',subClaims:[],decisions:[],citations:[citation,missing],answer:Array.from({length:8},(_,i)=>'A grounded finding [S1]. The archive also appears [S2]. '+('Evidence should be read in context. '.repeat(5))).join(String.fromCharCode(10,10)),totalSpent:0.002,totalToCreators:0.002,trace,createdAt:'2026-09-28T00:00:00Z',paymentMode:'real',evidence:Array.from({length:12},(_,i)=>({claimIndex:i,claim:'A grounded finding',marker:'S1',sourceId:'source-1',sourceName:'Research Journal',quote:i===0?'The measured result was positive.':('A long excerpt of measured evidence, exactly as stored in the run. '.repeat(4)),support:0.8,qualifiesForReward:true}))};
const payment = (itemId,status,amount) => ({kind:'citation',queryId:'synthetic',sourceId:'source-1',sourceName:'Research Journal',itemId,payer:'payer',payee:'author-wallet',amountUsdc:amount,network:'Arc',settled:status==='settled',settlementStatus:status,createdAt:run.createdAt});
run.confidence={level:'Moderate',reason:'Observed source grounding only'};run.citations.push(web);run.answer+=' Original public evidence [S3].';run.evidence.push({claimIndex:12,claim:'Original public evidence',marker:'S3',sourceId:web.sourceId,sourceName:web.sourceName,quote:'The original public document explicitly states this finding.',support:0.8,qualifiesForAnswer:true,qualifiesForReward:false,...web});
run.citations.push(scholarly);run.answer+=' Abstract-scoped finding [S4].';run.evidence.push({claimIndex:13,claim:'Abstract-scoped finding',quote:'This is the observed abstract passage.',support:0.8,qualifiesForAnswer:true,qualifiesForReward:false,...scholarly});
const payments = [payment('article-1','settled',0.001),payment('article-1','pending',0.002),payment('article-1','simulated',0.008),payment('other-article','settled',0.4),{...payment('article-1','settled',0.3),queryId:'other-run'},{...payment('article-1','simulated',0.006),settled:true}];
function groundedFixture(covered){
  const quote='The protocol binds approval to canonical action identity.';
  const evaluation='The benchmark includes ten commands.';
  const claims=['Methods','All attacks are eliminated'];
  const identity={marker:'S1',sourceId:'protocol',sourceName:'Protocol fixture',itemId:'protocol-item',itemTitle:'Protocol article',itemUrl:'https://fixture.invalid/protocol',contentVersion:'recorded-version',sourceKind:'public-reference'};
  const draft='The protocol binds approval [S1]. All attacks are eliminated [S1].';
  const ledger=buildEvidenceLedger({subClaims:claims,gathered:[{...identity,text:quote+' '+evaluation}],answer:draft,declaredMarkers:['S1'],
    proposedEvidence:[{claimIndex:0,marker:'S1',quote,quoteSpan:{start:0,end:quote.length},support:0.9},...(covered?[{claimIndex:1,marker:'S1',quote:evaluation,quoteSpan:{start:quote.length+1,end:quote.length+1+evaluation.length},support:0.9}]:[])],
    finalAssessment:claims.map((claim,index)=>({claim,coverage:index===0||covered?0.9:0,coveredBy:index===0||covered?['S1']:[]}))});
  return {...run,id:covered?'grounding-covered':'grounding-gap',subClaims:claims,trace:[],answer:finalizeGroundedAnswer({question:'Compare',answer:draft,ledger}),
    claimCoverage:ledger.claimCoverage,evidence:ledger.evidence,citations:[{...identity,weight:1,reward:0,rationale:'Qualified quoted contribution'}],
    confidence:{level:'Low',reason:'Complete synthesis and per-assertion support remain unverified'}};
}
function App(){const [steps,setSteps]=React.useState(trace);const [grounding,setGrounding]=React.useState(null);
window.prepareGroundingFixture=covered=>{const next=groundedFixture(covered);window.commitGroundingFixture=()=>setGrounding(next);};
window.addStep=()=>setSteps(s=>[...s,{phase:'discover',ts:s.length,message:'Step '+s.length}]);
if(grounding)return <section data-testid="grounding-result" data-run-id={grounding.id}><AnswerCard run={grounding} meta={null}/></section>;
return <><div style={{height:900}}>Reading fixture</div><DispatchView run={run} payments={payments}/><ReasoningConsole steps={steps} streaming={true} budget={0.01}/></>};
createRoot(document.getElementById('root')).render(<App/>);
`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  minify: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  write: false,
  define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_KERYX_SETTLEMENT_WALLET": '""',
    "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arcTestnet"', "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined",
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" },
  plugins: [{ name: "alias", setup(api) {
    api.onResolve({ filter: /^@\// }, ({ path: importPath }) => {
      const target = path.join(process.cwd(), importPath.slice(2));
      return { path: existsSync(`${target}.ts`) ? `${target}.ts` : `${target}.tsx` };
    });
  } }],
});

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/feedback") return route.fulfill({ json: { up: 0, down: 0 } });
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
  });
  await page.goto("https://reading.invalid");
  await page.addStyleTag({ content: stylesheet });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  assert.deepEqual(errors, [], "Reading fixture must boot with its compiled historical testnet profile");
  const citation = page.getByRole("button", { name: /Open evidence for The article/ }).first();
  await citation.waitFor();
  const citationElement = await citation.elementHandle();
  assert(citationElement, "citation trigger must exist for focus restoration checks");
  await page.getByText("1 citations omitted because an article title or usable article link is unavailable.").waitFor();
  await page.getByText("Research evidence matrix", { exact: true }).click();
  for (const [button, filename, expected] of [
    ["Download BibTeX", "keryx-references.bib", "@misc{keryx"],
    ["Download RIS (Zotero)", "keryx-references.ris", "TY  - WEB"],
    ["Download evidence CSV", "keryx-evidence-matrix.csv", '"claim_index","claim","inspection_status"'],
  ]) {
    const waiting = page.waitForEvent("download");
    await page.getByRole("button", { name: button, exact: true }).click();
    const download = await waiting;
    assert.equal(download.suggestedFilename(), filename);
    const stream = await download.createReadStream();
    assert(stream, "download should provide bytes");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const content = Buffer.concat(chunks).toString("utf8");
    assert(content.includes(expected), `${filename} must contain its expected format`);
    assert(!content.includes("author-wallet") && !content.includes("payer"), "exports exclude payment identities");
    if (filename.endsWith(".ris") || filename.endsWith(".bib")) {
      assert(content.includes("https://example.org/article"));
      assert(content.includes("https://publisher.example/final"), "public no-reward citations remain exportable");
      assert(!content.includes("Legacy article"), "legacy citations must not receive invented article links");
      assert(content.includes("1706.03762v7") && content.includes("Observed Author"));
      assert(content.includes("Read scope: abstract-page. Preprint. Peer review unknown"));
    }
    if (filename.endsWith(".csv")) assert(content.includes("The original public document explicitly states this finding."), "answer-qualified public evidence remains inspectable without payout authority");
  }
  await page.getByText("Research evidence matrix", { exact: true }).click();
  await citation.evaluate(element => element.scrollIntoView({ behavior: "instant" }));
  const before = await page.evaluate(() => scrollY);
  await citation.click();
  const lockedY = await page.evaluate(() => -parseFloat(document.body.style.top));
  assert.equal(await page.evaluate(() => document.body.style.position), "fixed");
  const dialog = page.getByRole("dialog", { name: /The article/ });
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /The measured result was positive/);
  assert.match(await dialog.innerText(), /Research target \(unverified\):/);
  assert.doesNotMatch(await dialog.innerText(), /Supports:/);
  assert.match(await dialog.innerText(), /\$0\.001.*settled/);
  assert.match(await dialog.innerText(), /pending confirmation/);
  assert.match(await dialog.innerText(), /offline simulated payment/);
  assert.match(await dialog.innerText(), /conflicting settlement fields/);
  assert.doesNotMatch(await dialog.innerText(), /0\.4/);
  assert.doesNotMatch(await dialog.innerText(), /0\.3/);
  assert(await citation.evaluate(element => { element.focus(); return document.activeElement !== element; }));
  await page.keyboard.press("Shift+Tab");
  assert(await page.evaluate(() => document.activeElement?.closest('dialog') !== null));
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await page.waitForFunction(element => document.activeElement === element, citationElement, { timeout: 2000 });
  assert.equal(await page.evaluate(() => scrollY), lockedY, `reading position changed after closing: before click ${before}, locked ${lockedY}`);
  await page.getByRole("button", { name: "Open evidence for Legacy article" }).first().click();
  const legacy = page.getByRole("dialog", { name: "Legacy article" });
  assert.match(await legacy.innerText(), /No supporting excerpt is stored/);
  assert.match(await legacy.innerText(), /No settled citation payment is recorded/);
  await page.mouse.click(2, 2);
  await legacy.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Open evidence for Original public document" }).first().click();
  assert.match(await page.locator("body").innerText(), /source grounding/);
  const publicEvidence = page.getByRole("dialog", { name: "Original public document" });
  assert.match(await publicEvidence.innerText(), /extracted pdf text.*bounded excerpt/);
  assert.match(await publicEvidence.innerText(), /retrieved 2026-10-01T00:00:00Z/);
  assert.match(await publicEvidence.innerText(), /source grounding, not factual verification/);
  assert.match(await publicEvidence.innerText(), /registrable-domain proxy/);
  assert.doesNotMatch(await publicEvidence.innerText(), /RSS delivery/);
  assert.equal(await publicEvidence.locator('a[href="https://publisher.example/final"]').count(), 1);
  await page.keyboard.press("Escape"); await publicEvidence.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Open evidence for Observed scholarly preprint" }).first().click();
  const paperEvidence = page.getByRole("dialog", { name: "Observed scholarly preprint" });
  await paperEvidence.waitFor();
  assert.match(await paperEvidence.innerText(), /Preprint · peer review unknown/);
  assert.match(await paperEvidence.innerText(), /abstract page only; full paper unavailable/);
  assert.match(await paperEvidence.innerText(), /Authors \(arxiv\): Observed Author/);
  assert.doesNotMatch(await paperEvidence.innerText(), /Author name: not stored/);
  await page.keyboard.press("Escape"); await paperEvidence.waitFor({ state: "detached" });

  for (const viewport of [
    { width: 320, height: 640 }, { width: 390, height: 800 },
    { width: 768, height: 800 }, { width: 1024, height: 800 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const positions = await page.evaluate(() => {
      const elements = [...document.querySelectorAll("*")];
      return {
        answer: elements.find(element => element.textContent?.trim() === "The reading")?.getBoundingClientRect().top ?? NaN,
        payment: elements.find(element => element.textContent?.trim() === "The settlement")?.getBoundingClientRect().top ?? NaN,
        log: [...document.querySelectorAll("summary")].find(element => element.textContent?.includes("Decision log"))?.getBoundingClientRect().top ?? NaN,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    assert(Number.isFinite(positions.answer) && Number.isFinite(positions.payment) && Number.isFinite(positions.log));
    assert(positions.answer <= positions.payment + 1, `answer must lead payment at ${viewport.width}px`);
    assert(positions.answer < positions.log, `answer must lead decision log at ${viewport.width}px`);
    assert(positions.scrollWidth <= viewport.width + 1, `horizontal overflow at ${viewport.width}px: ${positions.scrollWidth}`);

    await citation.evaluate(element => element.scrollIntoView({ behavior: "instant" }));
    const readingY = await page.evaluate(() => scrollY);
    await citation.click();
    const dialogY = await page.evaluate(() => -parseFloat(document.body.style.top));
    await dialog.waitFor();
    const geometry = await dialog.evaluate(element => {
      element.scrollTop = element.scrollHeight;
      const box = element.getBoundingClientRect();
      const close = element.querySelector<HTMLButtonElement>('button[aria-label="Close citation evidence"]')!.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width,
        position: getComputedStyle(element).position, closeTop: close.top, closeBottom: close.bottom,
        scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
    });
    assert.equal(geometry.position, "fixed", `built CSS must style dialog at ${viewport.width}px`);
    assert(geometry.left >= -1 && geometry.right <= viewport.width + 1, `dialog horizontal fit at ${viewport.width}px`);
    assert(geometry.top >= -1 && geometry.bottom <= viewport.height + 1, `dialog vertical fit at ${viewport.width}px`);
    if (viewport.width >= 768) assert(geometry.width <= 461, `desktop side panel width at ${viewport.width}px`);
    assert(geometry.scrollHeight > geometry.clientHeight, `long evidence should scroll at ${viewport.width}px`);
    assert(geometry.closeTop >= geometry.top && geometry.closeBottom <= geometry.bottom, `close must stay visible at ${viewport.width}px`);
    await page.getByRole("button", { name: "Close citation evidence" }).click();
    await dialog.waitFor({ state: "detached" });
    await page.waitForFunction(element => document.activeElement === element, citationElement, { timeout: 2000 });
    assert.equal(await page.evaluate(() => scrollY), dialogY, `reading position changed at ${viewport.width}px; before click ${readingY}, locked ${dialogY}`);
  }

  const log = page.getByLabel("Decision log").last();
  await log.evaluate(element => { element.style.height = "120px"; element.style.maxHeight = "120px"; element.style.overflowY = "auto"; element.firstElementChild.style.minHeight = "1600px"; });
  await log.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event("scroll", { bubbles: true })); });
  await page.evaluate(() => window.addStep());
  await page.waitForTimeout(40);
  assert(await log.evaluate(element => element.scrollTop > 0));
  await log.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll", { bubbles: true })); });
  await page.getByRole("button", { name: "Jump to latest" }).waitFor();
  await page.evaluate(() => window.addStep());
  assert.equal(await log.evaluate(element => element.scrollTop), 0);
  await page.getByRole("button", { name: "Jump to latest" }).click();
  assert(await log.evaluate(element => element.scrollTop > 0));
  for (const covered of [false, true]) {
    // Hold the next result explicitly: shared intro text can match the previous React
    // render. The expected identity must be absent until this prepared result commits.
    await page.evaluate(covered => (window as unknown as { prepareGroundingFixture: (covered: boolean) => void }).prepareGroundingFixture(covered), covered);
    const result = page.locator(`[data-testid="grounding-result"][data-run-id="${covered ? "grounding-covered" : "grounding-gap"}"]`);
    assert.equal(await result.count(), 0, "an uncommitted fixture must not satisfy the next result identity");
    if (covered) {
      assert.equal(await page.locator('[data-testid="grounding-result"][data-run-id="grounding-gap"]').count(), 1,
        "the previous gap result remains rendered while the covered result is held");
      assert.equal(await page.getByText("Source excerpts only.", { exact: false }).count(), 1,
        "shared intro text still matches the old result and cannot synchronize a new snapshot");
    }
    await page.evaluate(() => (window as unknown as { commitGroundingFixture: () => void }).commitGroundingFixture());
    await result.waitFor();
    await result.getByText("Source excerpts only.", { exact: false }).waitFor();
    const rendered = await result.innerText();
    assert(!rendered.includes("All attacks are eliminated [S1]"), "same-source omitted assertion must not survive the minified finalizer");
    assert(rendered.includes('Requested topic (unverified): “All attacks are eliminated”'), "overbroad target must be labelled as an unverified topic");
    assert(rendered.includes('“The protocol binds approval to canonical action identity.”'), "qualified source excerpt must remain quoted");
    assert.equal(rendered.includes('“The benchmark includes ten commands.”'), covered);
    assert(rendered.includes("90% estimated"), "coverage must be presented as an estimate");
    assert(rendered.includes("not proof of entailment"));
    const matrix = result.getByText("Research evidence matrix", { exact: true });
    if (!await matrix.evaluate(element => element.closest("details")?.open)) await matrix.click();
    await result.getByRole("columnheader", { name: "Research target (unverified)" }).waitFor();
    assert.equal(await result.getByRole("button", { name: /Open evidence for Protocol article/ }).count(), covered ? 2 : 1,
      "only quoted evidence should create answer citation controls");
  }
  assert.deepEqual(errors, []);
  console.log("PASS: citation evidence/payment state, modal focus/scroll, contained log following, minified omitted-assertion projection, unverified target labels, and held-render result-identity synchronization");
} finally {
  await browser.close();
}
