/** ORIGINAL268 source-browser control. All HTTP/session/result data are synthetic.
 * Parent executes this finite control; it is not compiled Next, live SIWE/store,
 * payment, packed MCP or production acceptance. No runtime clock is replaced. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, stop as stopEsbuild, version as esbuildVersion } from "esbuild";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
assert(args.length >= 1 && args.length <= 2 && args.every(a => /^--(?:output|port)=/.test(a)), "Use --output=ABSOLUTE [--port=0|RESERVED_PORT]");
assert.equal(args.filter(a => a.startsWith("--output=")).length, 1);
assert(args.filter(a => a.startsWith("--port=")).length <= 1);
const output = args.find(a => a.startsWith("--output="))!.slice(9);
assert(isAbsolute(output) && resolve(output) !== resolve(root), "Own a separate absolute output directory");
const portText = args.find(a => a.startsWith("--port="))?.slice(7) ?? "0";
assert(/^(0|[1-9]\d{3,4})$/.test(portText) && Number(portText) <= 65535, "Use ephemeral loopback or a reserved nonprivileged port");
assert(Number(portText) === 0 || Number(portText) >= 1024, "Reserve a nonprivileged port");
for (const [name, leaf] of [["TEMP", "temp"], ["TMP", "temp"], ["TSX_CACHE_DIR", "tsx-cache"]] as const)
  assert(process.env[name] && resolve(process.env[name]!) === resolve(output, leaf), `Parent must isolate ${name} under output/${leaf}`);
const runOutput = join(output, "run");
await mkdir(runOutput); // Exclusive run directory: never overwrite another run/evidence.

async function bounded<T>(promise: Promise<T>, label: string, milliseconds = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: observation deadline exceeded`)), milliseconds);
  })]); } finally { clearTimeout(timer); }
}

const owner = `0x${"a".repeat(40)}`, jobId = `prv_${"1".padStart(64, "0")}`;
const question = "SYNTHETIC ORIGINAL268 completed owner question";
const answer = "SYNTHETIC ORIGINAL268 retained answer <img src=x onerror=alert(1)>";
const timestamp = "2026-10-01T00:00:00.000Z";
const envelope = { format: "private-job-history-v1", wallet: owner, scope: "exact-payer-private-current-store",
  capabilities: { completedPrivateJobs: true, exactPayerOnly: true, multiwallet: false,
    creatorReceipts: false, privacyMutation: false, publicReportLinks: false },
  qualification: "Exact-payer current-store completed private jobs only; bounded intent scan, not a transaction snapshot or all archives. No linked-wallet inheritance, creator ledger, privacy mutation or public report links." };
const row = { id: jobId, ownerWallet: owner, createdAt: timestamp, intentCreatedAt: timestamp, savedAt: timestamp,
  question, researchMode: "quick", model: null, packageVersion: "1.0.0", record: "finalized-private-result", provenance: null,
  incomingSettlement: { status: "settled", amountMicros: "50000", network: "eip155:5042002", reference: "synthetic-only",
    settledAt: timestamp, evidenceSource: "circle-facilitator-success", chainFinalityVerified: false },
  ownSettledSpendMicros: null, creatorRewardsMicros: null, paidCreators: null };
const list = { ...envelope, rows: [row], nextCursor: null, scanLimited: false, scannedIntents: 1 };
const detail = { ...envelope, row: { ...row, intentCreatedAt: null }, result: { answer, engine: "synthetic-only",
  createdAt: timestamp, savedAt: timestamp, subClaims: [], decisions: [], citations: [], evidence: null, claimCoverage: null,
  paymentEvidence: "incoming-only-no-creator-ledger" } };
assert(Buffer.byteLength(JSON.stringify(list)) < 1_500_000 && Buffer.byteLength(JSON.stringify(detail)) < 1_500_000);

// This is the sole injected transport seam. It always obtains bytes from the
// guarded loopback HTTP server. Held private/session responses intentionally
// ignore cancellation to exercise the real hook/component's stale fences. Held
// logout ACKs honor the real signal; late ACK release records a discard.
const entry = String.raw`
import React,{useState} from 'react';
import{createRoot}from'react-dom/client';
import{PrivateJobHistoryWorkspace}from'./components/keryx/private-job-history-workspace';
import{useSiweAuth}from'./lib/hooks/use-siwe-auth';
const nativeFetch=window.fetch.bind(window), plans=[], requests=[], events=[], messages=[], paints=[], transportErrors=[], timers=new Set();
const refuse=message=>{transportErrors.push(message);throw Error(message)};
const observer=new BroadcastChannel('keryx-auth-v1');
observer.onmessage=e=>messages.push({value:e.data,at:performance.now()});
window.addEventListener('keryx:auth',e=>events.push({value:e.detail??null,at:performance.now()}),true);
const allowed=new Map([['/api/auth/session','GET'],['/api/auth/signout','POST'],['/api/me/private-jobs','POST'],['/api/me/private-jobs/detail','POST']]);
window.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url??input,location.href), method=init.method??'GET';
  if(url.origin!==location.origin||url.search||url.hash||allowed.get(url.pathname)!==method)refuse('Unexpected synthetic HTTP endpoint');
  if(init.cache!=='no-store')refuse('Missing no-store request');
  if(url.pathname.startsWith('/api/me/')){
    if(init.credentials!=='same-origin'||init.redirect!=='error'||init.referrerPolicy!=='no-referrer')refuse('Changed private origin contract');
    const headers=new Headers(init.headers);
    if(headers.get('content-type')!=='application/json'||headers.get('x-keryx-expected-wallet')!==CONNECTOR_ADDRESS)refuse('Changed private JSON/owner precondition');
    if(new TextEncoder().encode(init.body).byteLength>8192)refuse('Oversized private request');
    const body=JSON.parse(init.body);
    if(JSON.stringify(body)!==(url.pathname.endsWith('/detail')?JSON.stringify({id:JOB_ID}):JSON.stringify({limit:25})))refuse('Changed exact request body');
  }else if(init.body!==undefined)refuse('Unexpected auth request body');
  if(requests.length>=128)refuse('Synthetic browser request budget exceeded');
  const index=plans.findIndex(p=>p.path===url.pathname), plan=index<0?null:plans.splice(index,1)[0];
  const item={id:requests.length,path:url.pathname,started:performance.now(),ready:false,returned:false,aborted:false,abortAt:null,bodyCancelled:false,released:false,discarded:false,release:null};
  requests.push(item);
  const aborted=()=>{item.aborted=true;item.abortAt??=performance.now()};
  init.signal?.addEventListener('abort',aborted,{once:true});if(init.signal?.aborted)aborted();
  const response=await nativeFetch(input,plan?{...init,signal:undefined}:init);
  if(response.headers.get('cache-control')!=='no-store'||url.pathname.startsWith('/api/me/')&&response.headers.get('vary')!=='Cookie, Authorization, X-Keryx-Expected-Wallet')refuse('Changed synthetic private response headers');
  if(!plan){item.ready=true;item.returned=true;return response}
  if(plan.mode==='body'){
    const bytes=new Uint8Array(await response.arrayBuffer());
    let controller;
    const stream=new ReadableStream({start(c){controller=c},cancel(){item.bodyCancelled=true}});
    item.release=()=>{item.released=true;if(item.bodyCancelled){item.discarded=true;return}controller.enqueue(bytes);controller.close()};
    item.ready=true;item.returned=true;
    return new Response(stream,{status:response.status,headers:response.headers});
  }
  return new Promise((resolve,reject)=>{
    let settled=false;
    const cancel=()=>{if(!plan.honorAbort||settled)return;settled=true;reject(init.signal.reason)};
    item.release=()=>{item.released=true;init.signal?.removeEventListener('abort',cancel);if(settled){item.discarded=true;void response.body?.cancel();return}settled=true;item.returned=true;resolve(response)};
    init.signal?.addEventListener('abort',cancel,{once:true});
    item.ready=true;if(init.signal?.aborted)cancel();
  });
};
function Actor(){
  const auth=useSiweAuth(),[show,setShow]=useState(true),[outcome,setOutcome]=useState('none');
  return <><aside aria-label="Real auth actor" data-testid="actor" data-state={auth.authState}
    data-session={auth.session===undefined?'checking':auth.session===null?'signed-out':auth.session.address}
    data-role={auth.session?.role??''}>
    <button onClick={()=>{setOutcome('pending');void auth.signOut().then(()=>setOutcome('acknowledged'),e=>setOutcome(e.message))}}>Logout in this tab</button>
    <button onClick={()=>void auth.refresh()}>Refresh actor session</button>
    <button onClick={()=>window.dispatchEvent(new Event('focus'))}>Check server sessions</button>
    <button onClick={()=>setShow(v=>!v)}>{show?'Unmount workspace':'Mount workspace'}</button>
    <output data-testid="logout-outcome">{outcome}</output>
  </aside><main data-testid="workspace">{show&&<PrivateJobHistoryWorkspace/>}</main></>
}
const root=createRoot(document.getElementById('root'));root.render(<Actor/>);
const mutation=new MutationObserver(()=>{const text=document.querySelector('main')?.textContent??'';if(text.includes(PRIVATE_QUESTION)||text.includes(PRIVATE_ANSWER))paints.push(text)});
mutation.observe(document.getElementById('root'),{subtree:true,childList:true,characterData:true});
const flush=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
window.__historyControl={realm:crypto.randomUUID(),requests,events,messages,paints,transportErrors,
  hold(path,mode='transport',honorAbort=false){if(!allowed.has(path)||plans.length>=8)throw Error('Invalid bounded hold');plans.push({path,mode,honorAbort})},
  release(id){const item=requests[id];if(!item?.ready||!item.release||item.released)throw Error('Invalid release');item.release()},
  post(value){const sender=new BroadcastChannel('keryx-auth-v1');sender.postMessage(value);sender.close()},flush,
  storm(source,start){let sequence=start;for(const delay of [5000,10000,18000]){const timer=setTimeout(()=>{timers.delete(timer);for(let n=0;n<8;n++)observer.postMessage({type:'logout',source,sequence:++sequence,pending:true,confirmed:true})},delay);timers.add(timer)}},
  close(){for(const timer of timers)clearTimeout(timer);timers.clear();root.unmount();mutation.disconnect();observer.close()}
};
`;

type Notice = { type: "logout"; source: string; sequence: number; pending: boolean; confirmed: boolean };
type RequestRecord = { id: number; path: string; started: number; ready: boolean; returned: boolean; aborted: boolean;
  abortAt: number | null; bodyCancelled: boolean; released: boolean; discarded: boolean };
type Snapshot = { realm: string; requests: RequestRecord[]; events: { value: Notice | string | null; at: number }[];
  messages: { value: Notice | string; at: number }[]; paints: string[]; transportErrors: string[] };
type Control = Snapshot & { hold(path: string, mode?: "transport" | "body", honorAbort?: boolean): void;
  release(id: number): void; post(value: Notice | string): void; flush(): Promise<void>; storm(source: string, start: number): void; close(): void };
type FixtureWindow = Window & { __historyControl: Control };
const SESSION = "/api/auth/session", LOGOUT = "/api/auth/signout", LIST = "/api/me/private-jobs", DETAIL = `${LIST}/detail`;
let session: { address: string; role: string } | null = null, epoch = 0, origin = "", browser: Browser | undefined;
const httpRequests: { method: string; path: string }[] = [], violations: string[] = [], pageErrors: string[] = [], blocked: string[] = [];
const results: Record<string, unknown>[] = [];
const pinnedPaths = ["scripts/test-private-job-history-workspace-browser.mts", "lib/hooks/use-siwe-auth.ts",
  "components/keryx/private-job-history-workspace.tsx", "lib/history/private-job-history-contract.ts"];
async function pinSources() {
  const pins = [];
  for (const path of pinnedPaths) {
    const bytes = await readFile(join(root, path)); pins.push({ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  return pins;
}

const server = createServer({ maxHeaderSize: 8192 }, async (request, response) => {
  response.setHeader("Cache-Control", "no-store"); response.setHeader("Connection", "close");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Robots-Tag", "noindex, nofollow");
  response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  try {
    assert(httpRequests.length < 256, "Finite loopback request budget");
    assert.equal(request.headers.host, new URL(origin).host, "Exact synthetic loopback host");
    const path = request.url!;
    httpRequests.push({ method: request.method!, path });
    if (request.method === "GET" && path === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<!doctype html><html lang="en"><head><title>Synthetic ORIGINAL268</title></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); return;
    }
    if (request.method === "GET" && path === "/fixture.js") {
      response.setHeader("Content-Type", "text/javascript; charset=utf-8"); response.end(bundleText); return;
    }
    assert([SESSION, LOGOUT, LIST, DETAIL].includes(path), "Only four exact synthetic API endpoints; no query selectors");
    assert.equal(request.method, path === SESSION ? "GET" : "POST", "Exact HTTP method");
    if (request.method === "POST") assert.equal(request.headers.origin, origin, "Exact same-origin CSRF boundary");
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of request) { bytes += chunk.length; assert(bytes <= 8192, "Request byte cap"); chunks.push(Buffer.from(chunk)); }
    const body = Buffer.concat(chunks).toString("utf8");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (path === SESSION || path === LOGOUT) {
      assert.equal(body, "", "Auth endpoints have no caller owner/body");
      if (path === LOGOUT) { session = null; response.end('{"ok":true}'); }
      else { if (!session) response.statusCode = 401; response.end(JSON.stringify({ session })); }
      return;
    }
    assert.equal(request.headers["x-keryx-expected-wallet"], owner, "Expected-wallet remains a precondition");
    response.setHeader("Vary", "Cookie, Authorization, X-Keryx-Expected-Wallet");
    assert.equal(request.headers["content-type"], "application/json");
    assert(session, "Synthetic server session must exist for a private read");
    assert.deepEqual(JSON.parse(body), path === LIST ? { limit: 25 } : { id: jobId }, "Exact private JSON body");
    const data = JSON.stringify(path === LIST ? list : detail);
    assert(Buffer.byteLength(data) <= 1_500_000, "Synthetic response stays under unchanged decoded-byte cap");
    response.setHeader("Content-Length", Buffer.byteLength(data)); response.end(data);
  } catch (error) {
    violations.push(error instanceof Error ? error.message : String(error));
    response.statusCode = 500; response.end('{"error":"synthetic transport guard refused"}');
  }
});
server.maxConnections = 16; server.headersTimeout = 5000; server.requestTimeout = 5000; server.keepAliveTimeout = 500;
let bundleText = "";

const snapshot = (page: Page) => page.evaluate(() => {
  const c = (window as FixtureWindow).__historyControl;
  return { realm: c.realm, requests: c.requests.map(({ release: ignored, ...r }: RequestRecord & { release?: unknown }) => { void ignored; return r; }),
    events: c.events, messages: c.messages, paints: c.paints, transportErrors: c.transportErrors };
}) as Promise<Snapshot>;
const flush = (page: Page) => page.evaluate(() => (window as FixtureWindow).__historyControl.flush());
const hold = (page: Page, path: string, mode: "transport" | "body" = "transport", honorAbort = false) =>
  page.evaluate(({ path, mode, honorAbort }) => (window as FixtureWindow).__historyControl.hold(path, mode, honorAbort), { path, mode, honorAbort });
const release = async (page: Page, id: number) => { await page.evaluate(id => (window as FixtureWindow).__historyControl.release(id), id); await flush(page); };
async function post(page: Page, value: Notice | string) {
  const after = (await snapshot(page)).messages.length;
  await page.evaluate(value => (window as FixtureWindow).__historyControl.post(value), value);
  await page.waitForFunction(({ after, encoded }) => (window as FixtureWindow).__historyControl.messages
    .slice(after).some(m => JSON.stringify(m.value) === encoded), { after, encoded: JSON.stringify(value) });
  await flush(page);
}
const actor = (page: Page) => page.getByTestId("actor");
const workspace = (page: Page) => page.getByTestId("workspace");
async function held(page: Page, path: string, after: number): Promise<RequestRecord> {
  await page.waitForFunction(({ path, after }) => (window as FixtureWindow).__historyControl.requests
    .some(r => r.id >= after && r.path === path && r.ready), { path, after }, { timeout: 8000 });
  const record = (await snapshot(page)).requests.find(r => r.id >= after && r.path === path)!;
  assert.equal(record.aborted, false, `${path}: must be live before the tested cancellation boundary`); return record;
}
async function cleared(page: Page, paintStart?: number) {
  await workspace(page).getByRole("link", { name: "Sign in to view completed private jobs" }).waitFor();
  await flush(page);
  assert.equal(await workspace(page).getByText(question, { exact: true }).count(), 0, "Cleared owner row");
  assert.equal(await workspace(page).getByText(answer, { exact: true }).count(), 0, "Cleared saved private body");
  assert.equal(await actor(page).getAttribute("data-session"), "signed-out", "Real hook has no session");
  if (paintStart !== undefined) assert.deepEqual((await snapshot(page)).paints.slice(paintStart), [], "No transient private repaint after stale completion");
}
async function saved(page: Page) {
  await workspace(page).getByRole("button", { name: "View saved result", exact: true }).waitFor();
  await workspace(page).getByRole("button", { name: "View saved result", exact: true }).click();
  try { await workspace(page).getByText(answer, { exact: true }).waitFor(); }
  catch (originalTimeout) {
    // Failure-only observation of this guarded synthetic realm; no replay or new request.
    try {
      await bounded((async () => {
        const observed = await page.evaluate(() => {
          const node = document.querySelector('[data-testid="workspace"]');
          const c = (window as FixtureWindow).__historyControl;
          return { workspaceDom: node?.outerHTML.slice(0, 16384) ?? null,
            alerts: Array.from(node?.querySelectorAll('[role="alert"]') ?? []).slice(0, 8)
              .map(alert => (alert.textContent ?? "").slice(0, 512)),
            requests: c.requests.slice(0, 128).map(({ release: ignored, ...record }: RequestRecord & { release?: unknown }) => { void ignored; return record; }),
            transportErrors: c.transportErrors.slice(0, 128).map(message => message.slice(0, 512)) };
        });
        const admitted = new Map([["/", "GET"], ["/fixture.js", "GET"], [SESSION, "GET"], [LOGOUT, "POST"], [LIST, "POST"], [DETAIL, "POST"]]);
        await writeFile(join(runOutput, "saved-answer-failure.json"), JSON.stringify({
          scope: "Failure-only synthetic ORIGINAL268 saved-answer observation; no live acceptance",
          observed, httpRequests: httpRequests.filter(r => admitted.get(r.path) === r.method).slice(0, 256),
          serverGuardFailures: violations.length, blockedRequests: blocked.length, pageErrors: pageErrors.length,
        }, null, 2) + "\n", { flag: "wx" });
      })(), "Saved-answer failure diagnostic", 1000);
    } catch { console.error("Synthetic saved-answer diagnostic unavailable; original timeout retained."); }
    throw originalTimeout;
  }
  assert.equal(await workspace(page).locator("img").count(), 0, "Retained result is escaped text");
  await workspace(page).getByText("Own settled source spend: unavailable (NULL). Creator rewards: unavailable (NULL). Paid creators: unavailable (NULL).", { exact: true }).first().waitFor();
}
async function pendingDetail(page: Page, mode: "transport" | "body" = "transport") {
  await workspace(page).getByRole("button", { name: "Close result", exact: true }).click();
  const start = (await snapshot(page)).requests.length;
  await hold(page, DETAIL, mode); await workspace(page).getByRole("button", { name: "View saved result", exact: true }).click();
  return held(page, DETAIL, start);
}
async function oldActorSession(page: Page) {
  const start = (await snapshot(page)).requests.length;
  await hold(page, SESSION); await page.getByRole("button", { name: "Refresh actor session", exact: true }).click();
  return held(page, SESSION, start);
}
async function received(page: Page, source?: string, sequence?: number) {
  await page.waitForFunction(({ source, sequence }) => (window as FixtureWindow).__historyControl.messages.some(m =>
    typeof m.value === "object" && m.value.type === "logout" && (!source || m.value.source === source)
      && (sequence === undefined || m.value.sequence === sequence)), { source, sequence }, { timeout: 8000 });
  return (await snapshot(page)).messages.find(m => typeof m.value === "object" && (!source || m.value.source === source)
    && (sequence === undefined || m.value.sequence === sequence))!.value as Notice;
}
async function withPair(name: string, test: (a: Page, b: Page) => Promise<void>) {
  session = null;
  const context: BrowserContext = await browser!.newContext({ serviceWorkers: "block", viewport: { width: 960, height: 900 } });
  context.setDefaultTimeout(8000);
  await context.route("**/*", route => {
    const request = route.request(), url = request.url();
    const permitted = new Map([[`${origin}/`, "GET"], [`${origin}/fixture.js`, "GET"],
      [`${origin}${SESSION}`, "GET"], [`${origin}${LOGOUT}`, "POST"], [`${origin}${LIST}`, "POST"], [`${origin}${DETAIL}`, "POST"]]);
    if (permitted.get(url) === request.method()) return route.continue();
    blocked.push(`${request.method()} ${url}`); return route.abort("blockedbyclient");
  });
  const a = await context.newPage(), b = await context.newPage();
  for (const page of [a, b]) page.on("pageerror", error => pageErrors.push(`${name}: ${error.message}`));
  try {
    await a.goto(origin, { waitUntil: "load" }); await b.goto(origin, { waitUntil: "load" });
    await cleared(a); await cleared(b);
    for (const page of [a, b]) assert.equal((await snapshot(page)).requests.filter(r => r.path.startsWith(LIST)).length, 0,
      "Connected connector alone must not initiate private IO");
    const sa = await snapshot(a), sb = await snapshot(b);
    assert.notEqual(sa.realm, sb.realm, "Two distinct document realms, no shared hook module globals");
    assert.equal(await a.evaluate(() => location.origin), await b.evaluate(() => location.origin), "Shared real channel origin");
    session = { address: owner, role: `synthetic-epoch-${++epoch}` };
    for (const page of [a, b]) {
      await page.getByRole("button", { name: "Check server sessions", exact: true }).click();
      await workspace(page).getByText(question, { exact: true }).waitFor();
      await saved(page);
    }
    await test(a, b);
    for (const page of [a, b]) if (!page.isClosed()) {
      assert.deepEqual((await snapshot(page)).transportErrors, [], "No caught synthetic transport guard failures");
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0, "No private browser persistence");
      await page.evaluate(() => (window as FixtureWindow).__historyControl.close());
      await page.close();
    }
    assert.deepEqual(violations, [], "Strict synthetic server guard"); assert.deepEqual(blocked, [], "No external/unlisted network");
    assert.deepEqual(pageErrors, [], "No hidden browser exceptions");
    results.push({ case: name, passed: true });
  } finally { await bounded(context.close(), `${name}: context ownership cleanup`); }
}

try {
  const sourcePins = await pinSources();
  const bundle = await bounded(build({ absWorkingDir: root, stdin: { contents: entry, loader: "tsx", resolveDir: root },
    bundle: true, write: false, platform: "browser", format: "iife", target: "es2022", jsx: "automatic", metafile: true, logLevel: "silent",
    define: { "process.env": "{}", "process.env.NODE_ENV": '"production"', CONNECTOR_ADDRESS: JSON.stringify(owner), JOB_ID: JSON.stringify(jobId),
      PRIVATE_QUESTION: JSON.stringify(question), PRIVATE_ANSWER: JSON.stringify(answer) },
    plugins: [{ name: "synthetic-connector-provider-boundaries-only", setup(b) {
      b.onResolve({ filter: /^(wagmi|siwe|@\/lib\/chains|\.\.\/circle-wallet-config|\.\.\/circle-wallet-browser)$/ }, args => ({ path: args.path, namespace: "synthetic-boundary" }));
      b.onLoad({ filter: /.*/, namespace: "synthetic-boundary" }, args => ({ loader: "js", contents:
        args.path === "wagmi" ? `export const useAccount=()=>({address:${JSON.stringify(owner)},isConnected:true,connector:{id:'synthetic-unused'}});export const useSignMessage=()=>({signMessageAsync:()=>{throw Error('Real wallet/signing forbidden')}});` :
        args.path === "siwe" ? "export class SiweMessage{constructor(){throw Error('SIWE/signing forbidden in this control')}}" :
        args.path === "@/lib/chains" ? "export const arcChain={id:5042002};" :
        args.path.endsWith("circle-wallet-config") ? "export const CIRCLE_GOOGLE_CONNECTOR_ID='synthetic-google-unused';" :
        "export const circleWalletIdentity=()=>null;export const clearCircleWalletIdentity=()=>{};" }));
    } }] }), "In-memory esbuild ownership", 20000);
  const inputs = Object.keys(bundle.metafile!.inputs);
  for (const path of ["lib/hooks/use-siwe-auth.ts", "components/keryx/private-job-history-workspace.tsx", "lib/history/private-job-history-contract.ts"])
    assert(inputs.includes(path), `Bundle actual frozen ${path}`);
  assert(!inputs.some(path => /^(?:lib\/(?:db|payments|gateway|agent|mcp)\/|mcp\/|app\/api\/)/.test(path)), "No server/payment/research runtime imports");
  assert(inputs.some(path => /node_modules\/next\/.*link/.test(path)), "Use actual Next Link, no framework/auth/workspace stub");
  assert.equal(bundle.outputFiles.length, 1); assert(bundle.outputFiles[0].contents.byteLength <= 3 * 1024 * 1024, "Bound synthetic in-memory bundle");
  bundleText = bundle.outputFiles[0].text;
  await bounded(new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(Number(portText), "127.0.0.1", resolve); }), "Loopback listen");
  const address = server.address(); assert(address && typeof address !== "string"); origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true, timeout: 15000 });
  await bounded((async () => {
    await withPair("normal-json-ack-and-two-tab-stale-fences", async (a, b) => {
      const da = await pendingDetail(a), db = await pendingDetail(b, "body");
      const sa = await oldActorSession(a), sb = await oldActorSession(b);
      await hold(a, LOGOUT, "transport", true);
      await a.getByRole("button", { name: "Logout in this tab", exact: true }).click();
      const start = await received(b, undefined, 1);
      await cleared(a); await cleared(b);
      const aa = await snapshot(a), bb = await snapshot(b), ack = aa.requests.find(r => r.path === LOGOUT)!;
      assert(aa.requests[da.id].aborted && aa.requests[da.id].abortAt! <= ack.started, "Local private cancellation precedes signout HTTP");
      assert(bb.requests[db.id].aborted && bb.requests[db.id].bodyCancelled, "Peer boundary cancels real pending body reader");
      assert.equal(await actor(a).getAttribute("data-state"), "signing-out");
      assert.equal(await actor(b).getAttribute("data-state"), "signing-out");
      assert.equal(ack.aborted, false, "Normal ACK is held, not timed out");
      // A replay cannot impersonate the initiating document or end either owned interval.
      await post(b, { ...start, sequence: 1, pending: false, confirmed: true });
      assert.equal(await actor(a).getAttribute("data-state"), "signing-out", "Forged local UUID cannot end owned logout");
      const paintA = (await snapshot(a)).paints.length, paintB = (await snapshot(b)).paints.length;
      await release(a, da.id); await release(b, db.id); await release(a, sa.id); await release(b, sb.id);
      await cleared(a, paintA); await cleared(b, paintB);
      // Release the actual successful HTTP JSON ok:true ACK and observe its real terminal.
      await a.waitForFunction(() => (window as FixtureWindow).__historyControl.requests.some(r => r.path === "/api/auth/signout" && r.ready));
      await release(a, ack.id);
      await a.waitForFunction(() => document.querySelector('[data-testid="logout-outcome"]')?.textContent === "acknowledged");
      assert.equal(await a.getByTestId("logout-outcome").textContent(), "acknowledged", "Exact successful ACK outcome");
      await received(b, start.source, 2); await flush(b);
      const doneA = await snapshot(a), doneB = await snapshot(b);
      assert.equal(doneA.requests[ack.id].aborted, false, "Successful ACK has no observed timeout cancellation");
      assert.equal(doneA.events.filter(e => e.value === "signed-out").length, 1, "Only local JSON-confirmed ACK emits signed-out");
      assert.equal(doneB.events.filter(e => e.value === "signed-out").length, 0, "Peer claimed confirmation never confirms custody/auth");
      assert.equal(await actor(a).getAttribute("data-state"), "idle", "Local ACK ends its owned interval");
      assert.equal(await actor(b).getAttribute("data-state"), "idle", "Real terminal delivery ends peer pending without auth restoration");
      await cleared(a, paintA); await cleared(b, paintB);
    });

    await withPair("local-workspace-unmount-has-no-peer-authority", async (a, b) => {
      const da = await pendingDetail(a), db = await pendingDetail(b);
      const beforeB = await snapshot(b);
      await a.getByRole("button", { name: "Unmount workspace", exact: true }).click(); await flush(a); await flush(b);
      assert.equal(await workspace(a).textContent(), "", "Only local component unmounted");
      assert.equal((await snapshot(a)).requests[da.id].aborted, true, "Unmount cancels its own in-flight source attempt");
      assert.equal((await snapshot(b)).requests[db.id].aborted, false, "Peer source attempt stays live before response/finally abort");
      assert.deepEqual((await snapshot(b)).events, beforeB.events, "Unmount publishes no auth boundary");
      await release(b, db.id); await workspace(b).getByText(answer, { exact: true }).waitFor();
      await release(a, da.id); assert.equal(await workspace(a).textContent(), "", "Late local response cannot remount data");
      await a.getByRole("button", { name: "Mount workspace", exact: true }).click();
      await workspace(a).getByText(question, { exact: true }).waitFor();
    });

    await withPair("real-15s-abort-is-not-a-normal-ack", async (a, b) => {
      const da = await pendingDetail(a), db = await pendingDetail(b), sa = await oldActorSession(a), sb = await oldActorSession(b);
      await hold(a, LOGOUT, "transport", true); await a.getByRole("button", { name: "Logout in this tab", exact: true }).click();
      const start = await received(b, undefined, 1); await cleared(a); await cleared(b);
      await a.waitForFunction(() => (window as FixtureWindow).__historyControl.requests.some(r => r.path === "/api/auth/signout" && r.ready && r.aborted), undefined, { timeout: 18000 });
      await a.waitForFunction(() => document.querySelector('[data-testid="logout-outcome"]')?.textContent === "Sign-out could not be confirmed. Please retry.");
      assert.equal(await a.getByTestId("logout-outcome").textContent(), "Sign-out could not be confirmed. Please retry.", "Exact cancelled ACK failure");
      await received(b, start.source, 2); await flush(b);
      const state = await snapshot(a), ack = state.requests.find(r => r.path === LOGOUT)!;
      const elapsed = ack.abortAt! - ack.started;
      assert(elapsed >= 14900 && elapsed <= 17000, "Observed original 15000ms abort signal, with at most 2s scheduling slack");
      assert.equal(state.events.filter(e => e.value === "signed-out").length, 0, "Cancelled ACK stays unconfirmed");
      const paintA = state.paints.length, paintB = (await snapshot(b)).paints.length;
      await release(a, ack.id); assert.equal((await snapshot(a)).requests[ack.id].discarded, true, "Late aborted ACK cannot confirm");
      await release(a, da.id); await release(b, db.id); await release(a, sa.id); await release(b, sb.id);
      await cleared(a, paintA); await cleared(b, paintB);
      assert.equal((await snapshot(a)).events.filter(e => e.value === "signed-out").length, 0, "Late JSON cannot revive terminal attempt");
      assert.equal(await actor(b).getAttribute("data-state"), "idle", "Unconfirmed terminal ends pending without authenticating");
      results.push({ observation: "logout-abort", elapsedMs: elapsed, lateAckDiscarded: true });
    });

    await withPair("vanished-publisher-real-20s-lease-and-fresh-epoch", async (a, b) => {
      const db = await pendingDetail(b), sb = await oldActorSession(b);
      await hold(a, LOGOUT, "transport", true); await a.getByRole("button", { name: "Logout in this tab", exact: true }).click();
      const start = await received(b, undefined, 1); await cleared(b);
      const before = await snapshot(b), first = before.events.find(e => typeof e.value === "object" && e.value?.type === "logout" && e.value.source === start.source && e.value.pending)!;
      const paintStart = before.paints.length, lookupCount = before.requests.filter(r => r.path === SESSION).length;
      assert.deepEqual((await snapshot(a)).transportErrors, [], "Vanishing publisher has no hidden guard failures");
      await a.close(); // Genuine document disappearance; no synthetic terminal, kill or hook cleanup substitute.
      await b.evaluate(source => (window as FixtureWindow).__historyControl.storm(source, 1), start.source);
      await b.waitForFunction(source => (window as FixtureWindow).__historyControl.events.some(e =>
        typeof e.value === "object" && e.value?.type === "logout" && e.value.source === source && !e.value.pending), start.source, { timeout: 23000 });
      await flush(b);
      const expired = await snapshot(b), end = expired.events.find(e => typeof e.value === "object" && e.value?.type === "logout" && e.value.source === start.source && !e.value.pending)!;
      const elapsed = end.at - first.at;
      assert(elapsed >= 19900 && elapsed <= 22000, "Receiver's first-start 20000ms lease expires despite pending storms; at most 2s scheduling slack");
      assert.equal((end.value as Notice).sequence, 25, "All 24 higher pending/confirmed claims arrived before expiry");
      assert.equal((end.value as Notice).confirmed, false, "Lease expiry is not a logout ACK");
      assert.equal(await actor(b).getAttribute("data-state"), "idle");
      assert.equal(expired.requests.filter(r => r.path === SESSION).length, lookupCount, "Expiry/storm starts no automatic session lookup");
      assert.equal(expired.events.filter(e => e.value === "signed-out").length, 0);
      await post(b, { type: "logout", source: "synthetic-unrelated-no-authority", sequence: 1, pending: false, confirmed: true });
      await flush(b); await release(b, db.id); await release(b, sb.id); await cleared(b, paintStart);
      assert.equal((await snapshot(b)).events.filter(e => e.value === "signed-out").length, 0, "Unrelated peer confirmation cannot authenticate/confirm");
      session = null;
      const nullCheckStart = (await snapshot(b)).requests.length;
      await b.getByRole("button", { name: "Check server sessions", exact: true }).click();
      await b.waitForFunction(after => (window as FixtureWindow).__historyControl.requests.filter(r => r.id >= after && r.path === "/api/auth/session" && r.ready).length === 2, nullCheckStart);
      await flush(b); await cleared(b, paintStart);
      // Both actual hook instances must consume new HTTP session responses. Higher
      // notices in an exhausted interval cannot invalidate those held fresh bodies.
      session = { address: owner, role: `synthetic-epoch-${++epoch}` };
      const freshStart = (await snapshot(b)).requests.length;
      await hold(b, SESSION); await hold(b, SESSION); await hold(b, LIST);
      await b.getByRole("button", { name: "Check server sessions", exact: true }).click();
      await b.waitForFunction(after => (window as FixtureWindow).__historyControl.requests.filter(r => r.id >= after && r.path === "/api/auth/session" && r.ready).length === 2, freshStart);
      const freshSessions = (await snapshot(b)).requests.filter(r => r.id >= freshStart && r.path === SESSION);
      const exhausted = (sequence: number, pending = true): Notice => ({ ...start, sequence, pending, confirmed: true });
      const eventsBefore = (await snapshot(b)).events.length;
      await post(b, exhausted(26)); await flush(b);
      assert.equal((await snapshot(b)).events.length, eventsBefore, "Exhausted higher pending cannot advance auth epoch");
      for (const request of freshSessions) await release(b, request.id);
      const freshList = await held(b, LIST, freshStart);
      await post(b, exhausted(27)); await flush(b);
      assert.equal((await snapshot(b)).requests[freshList.id].aborted, false, "Exhausted pending cannot cancel fresh private IO");
      await release(b, freshList.id); await workspace(b).getByText(question, { exact: true }).waitFor(); await saved(b);
      assert.equal(await actor(b).getAttribute("data-role"), session.role, "Deliberate new server session established a fresh epoch");
      const retained = await snapshot(b);
      await post(b, exhausted(24, false)); await post(b, exhausted(28)); await flush(b);
      await workspace(b).getByText(answer, { exact: true }).waitFor();
      assert.equal((await snapshot(b)).requests.length, retained.requests.length, "Stale terminal/pending hints neither lookup nor read");
      assert.equal((await snapshot(b)).events.length, retained.events.length, "Old terminal and exhausted pending cannot revive/clear a fresh epoch");
      const newDetail = await pendingDetail(b);
      await post(b, exhausted(29, false)); await cleared(b);
      assert.equal((await snapshot(b)).requests[newDetail.id].aborted, true, "Accepted terminal is a clearing boundary, never restoration");
      const terminalPaint = (await snapshot(b)).paints.length;
      await release(b, newDetail.id); await cleared(b, terminalPaint);
      await post(b, exhausted(30)); await flush(b);
      assert.equal(await actor(b).getAttribute("data-state"), "signing-out", "Only terminal-ended new interval acquires a new pending boundary");
      await post(b, exhausted(31, false)); await flush(b); await cleared(b, terminalPaint);
      assert.equal(await actor(b).getAttribute("data-state"), "idle");
      await b.getByRole("button", { name: "Check server sessions", exact: true }).click();
      await workspace(b).getByText(question, { exact: true }).waitFor();
      results.push({ observation: "receiver-lease", elapsedMs: elapsed, pendingStormClaims: 24, freshHttpEpoch: true });
    });
  })(), "Whole finite four-scenario control", 95000);
  assert.deepEqual(violations, []); assert.deepEqual(blocked, []); assert.deepEqual(pageErrors, []);
  assert.deepEqual(await pinSources(), sourcePins, "Accepted bundle source stayed unchanged throughout this control");
  const evidence = { scope: "Synthetic loopback HTTP; actual bundled workspace/auth hook; two independent Chromium realms and native BroadcastChannel. No live acceptance.",
    node: process.version, browser: browser.version(), esbuild: esbuildVersion, origin, results,
    requests: httpRequests, externalRequests: blocked.length, bundleInputs: inputs, sourcePins,
    remainingGates: ["current compiled Next ordinary HTTP/RSC/API headers", "packed stdio/remote MCP cancellation and discovery", "parent required CI and delivery"] };
  await writeFile(join(runOutput, "synthetic-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
} finally {
  try { if (browser) await bounded(browser.close(), "Chromium ownership cleanup"); }
  finally {
    try { if (server.listening) await bounded(new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())), "Loopback natural close"); }
    finally { stopEsbuild(); }
  }
}
console.log(JSON.stringify({ scope: "Synthetic ORIGINAL268 two-tab control; no live acceptance", cases: 4,
  externalRequests: 0, evidence: join(runOutput, "synthetic-evidence.json"), ownershipCleanup: "completed" }));
