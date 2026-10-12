import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { installPackedConsumer } from "./packed-consumer-install.mjs";

const tarball = resolve(process.argv[2]);
const npmCli = process.env.npm_execpath ?? process.argv[3];
assert(npmCli, "Supply the pinned npm CLI path");
const workspace = await mkdtemp(join(tmpdir(), "keryx-mcp-consumer-"));
const children = new Set();
const exited = child => child.exitCode !== null || child.signalCode !== null;
async function stopChild(child) {
  if (exited(child)) return;
  await new Promise((resolveExit, reject) => {
    let escalation;
    const deadline = setTimeout(() => {
      child.kill("SIGKILL");
      escalation = setTimeout(() => finish(new Error("Synthetic MCP child did not exit after forced termination")), 5000);
    }, 5000);
    const finish = error => {
      clearTimeout(deadline); clearTimeout(escalation); child.off("exit", onExit);
      error ? reject(error) : resolveExit();
    };
    const onExit = () => finish();
    child.once("exit", onExit);
    child.kill();
    if (exited(child)) finish();
  });
}
try {
  await writeFile(join(workspace, "package.json"), JSON.stringify({ private: true, type: "module" }));
  installPackedConsumer(npmCli, tarball, workspace);
  const installedPackage = JSON.parse(await readFile(join(workspace, "node_modules/keryx-mcp/package.json"), "utf8"));
  const expectedPackage = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(installedPackage.version, expectedPackage.version);
  const dependencies = {};
  for (const name of ["@circle-fin/x402-batching", "viem", "@modelcontextprotocol/sdk", "zod"]) {
    dependencies[name] = JSON.parse(await readFile(join(workspace, "node_modules", name, "package.json"), "utf8")).version;
    assert.equal(dependencies[name], installedPackage.dependencies[name]);
  }
  const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  // Golden public HTTP-port data, not a source-helper import or producer authority.
  const packet = {
    schema: 3, policy: "ordinary-read-optimizer-v3", coverage: "normalization-optimizer-read-checkpoints", monetaryAuthority: "qualified-assertions-only",
    records: [{ sequence: 0, candidate: 1, round: 0, proposal: "CACHE", plan: "CACHE", facts: "assertions",
      check: { kind: "selection", plan: "CACHE", external: false }, outcome: { action: "CONTINUE", rule: "selected-plan" },
      amounts: { priceMicros: "0", remainingMicros: "50000" } }],
    mappings: [], normalizations: [], portfolio: null, stops: [],
    observations: { actions: [{ candidate: 1, action: "CACHE", price: "0", priceMicros: "0" }],
      citations: [{ candidate: 1, reward: "0.000001", rewardMicros: "1" }],
      payments: [{ candidate: 1, kind: "citation", amount: "0.000001", amountMicros: "1", status: "pending", settled: false }] },
    optimizer: { status: "available", policy: "claim-coverage-replay-v1", sourcePolicy: "claim-coverage-v1", facts: "assertions",
      input: { claimCount: 1, attentionLimit: 1, fetchBudget: "0.05", fetchBudgetMicros: "50000",
        candidates: [{ candidate: 1, documentGroup: 1, idRank: 0, action: "CACHE", price: "0", priceMicros: "0", expectedValue: "1", targets: [0], public: false }] },
      ties: [], outcome: { selectionMethod: "exhaustive", evaluatedStates: 2, eligibleCandidates: 1, attentionLimit: 1, selected: [1],
        cap: "0.05", reserved: "0", unused: "0.05", capMicros: "50000", reservedMicros: "0", unusedMicros: "50000",
        predictedCoveredClaims: 1, claims: [{ claimIndex: 0, selected: [1], coverage: "1" }] } },
  };
  const capture = packet => ({ status: "available", packet, retainedDigest: hash(packet) });
  const partialPacket = { ...packet, optimizer: { status: "unavailable", reason: "capture-bound" } };
  const privateSentinels = ["PACKED_PRIVATE_QUESTION_SENTINEL", "PACKED_PRIVATE_TOKEN_SENTINEL"];
  const privatePacket = { ...packet, question: privateSentinels[0], sourceUrl: `https://private.invalid/?token=${privateSentinels[1]}` };
  const portVectors = [
    { question: "Explain the café protocol – keep [PACKED-V3-AVAILABLE] exact.", language: "vi", readCheckpoints: capture(packet) },
    { question: "Explain the café protocol – keep [PACKED-V3-PARTIAL] exact.", language: "pt-BR", readCheckpoints: capture(partialPacket) },
    { question: "Explain the café protocol – keep [PACKED-V3-PRIVATE] exact.", language: "vi", readCheckpoints: capture(privatePacket) },
  ];
  const publicResult = {
    answer: "Exact untranslated fixture answer: café – [S1].",
    citations: [{ marker: "[S1]", sourceId: "synthetic-public-source", sourceName: "Exact synthetic source", source: "Exact synthetic source", weight: 1, reward: 0.000001 }],
    evidence: [{ claimIndex: 0, claim: "Exact synthetic claim", marker: "[S1]", sourceId: "synthetic-public-source", sourceName: "Exact synthetic source", source: "Exact synthetic source",
      quote: "EXACT EXCERPT: café is unchanged – [S1].", support: 1, qualifiesForAnswer: true, qualifiesForReward: true }],
    creatorsPaid: null, creatorsPaidAuthority: "distinct-settled-count-unavailable", totalToCreators: 0.000001, feePaid: 0.05,
    paymentMode: "real", pendingSpendUsdc: 0.000001,
    serviceReceipt: { packageId: "keryx-deep", packageVersion: "1.0.0", outcome: "completed", acceptedAt: "2026-10-06T00:00:00.000Z",
      startedAt: "2026-10-06T00:00:00.000Z", finishedAt: "2026-10-06T00:00:01.000Z", queueDurationMs: 0, executionDurationMs: 1000,
      totalDurationMs: 1000, targetCompletionMs: 300000, targetMet: true, objectiveKind: "provisional_slo", remedy: "none" },
  };
  const mock = join(workspace, "synthetic-network.cjs");
  await writeFile(mock, `
const fs=require('node:fs'), crypto=require('node:crypto'), viem=require('viem');
const counts={paid:0,rpc:0,recovery:0,bibliography:0,bibliographyQueries:[],researchRequests:[],researchResults:[]};
const portVectors=${JSON.stringify(portVectors)},publicResult=${JSON.stringify(publicResult)};
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reasoning={engine:'llm:deepseek:deepseek-v4-flash',
 reasoningAttempts:[{step:'decompose',engine:'llm:deepseek:deepseek-v4-flash',tier:0,attempt:1,startedAt:1,durationMs:0,outcome:'served'},
 {step:'decide',engine:'heuristic',tier:3,attempt:1,startedAt:2,durationMs:0,outcome:'served'},
 {step:'synthesize',engine:'llm:deepseek:deepseek-v4-flash',tier:0,attempt:1,startedAt:3,durationMs:0,outcome:'failed',error:'output_validation',outputTokenLimit:2560}],
 reasoning:{telemetry:'recorded',attemptsOmitted:0,
 steps:[{step:'decompose',state:'model',servingEngines:['llm:deepseek:deepseek-v4-flash'],fallbackUsed:false},
 {step:'decide',state:'heuristic',servingEngines:['heuristic'],fallbackUsed:true}],
 sourceSelection:{step:'decide',state:'heuristic',servingEngines:['heuristic'],fallbackUsed:true}}};
const mainnet=process.env.KERYX_NETWORK==='arc', chain=mainnet?5042:5042002, network='eip155:'+chain, gateway=mainnet?'0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE':'0x0077777d7EBA4688BDeF3E311b846F25870A19B9', balanceApi=mainnet?'https://gateway-api.circle.com/v1/balances':'https://gateway-api-testnet.circle.com/v1/balances';
const save=()=>fs.writeFileSync(process.env.TEST_COUNTS,JSON.stringify(counts));
const deny=()=>{throw new Error('Live network forbidden in package acceptance');};
for(const name of ['node:http','node:https']){const m=require(name);m.request=deny;m.get=deny;}
const net=require('node:net');net.connect=deny;net.createConnection=deny;net.Socket.prototype.connect=deny;
globalThis.fetch=async(input,init)=>{
 const url=String(input),body=init?.body?JSON.parse(init.body):null;
 if(url.startsWith('https://synthetic.example/api/papers?')){
  if(init.method!=='GET'||init.body||init.headers)throw new Error('Bibliography must be a keyless GET');
  const query=new URL(url).searchParams;if(query.get('q')!=='2005.11401v4')throw new Error('Wrong bibliography identity');
  counts.bibliography++;counts.bibliographyQueries.push(query.get('search')||'0');save();
  const record={title:'Synthetic exact-version bibliography',authors:['First Author','Second Author'],authorCount:2,authorsTruncated:false,
   arxivId:'2005.11401v4',repository:'arxiv',url:'https://arxiv.org/abs/2005.11401v4',metadataUrl:'https://export.arxiv.org/api/query?id_list=2005.11401v4',
   metadataObservedAt:'2026-10-06T00:00:00.000Z',publicationKind:'preprint',peerReview:'unknown'};
  return Response.json({version:1,scope:'bibliography-only',groups:[{id:'paper:'+crypto.createHash('sha256').update('2005.11401').digest('hex'),record,records:[record]}],totalWorks:1,catalogRecords:1,
   providers:query.get('search')==='1'?[{name:'arxiv',status:'unavailable',records:0}]:[]});
 }
 if(process.env.TEST_MODE==='keyless')throw new Error('No network allowed for missing custody');
 if(body?.jsonrpc==='2.0'){
  counts.rpc++;save();let result;
  if(body.method==='eth_chainId')result='0x'+chain.toString(16);
  else if(body.method==='eth_getBalance')result='0xde0b6b3a7640000';
  else if(body.method==='eth_call')result='0x'+(1000000n).toString(16).padStart(64,'0');
  else throw new Error('Unexpected RPC '+body.method);
  return Response.json({jsonrpc:'2.0',id:body.id,result});
 }
 if(url===balanceApi)return Response.json({token:'USDC',balances:[{depositor:body.sources[0].depositor,domain:26,balance:'1'}]});
 if(url.startsWith('https://synthetic.example/api/agent/ask?queryId=')){
  counts.recovery++;save();const queryId=new URL(url).searchParams.get('queryId');
  return Response.json({queryId,status:'completed',answer:'Recovered original synthetic answer',citations:[],creatorsPaid:0,totalToCreators:0,feePaid:0.05,...reasoning});
 }
 if(url!=='https://synthetic.example/api/agent/ask')throw new Error('Unapproved synthetic destination');
 const encoded=init.headers['Payment-Signature'];
 if(process.env.TEST_MODE==='presentation'){
  if(init.method!=='POST'||typeof init.body!=='string')throw new Error('Research must retain its original POST body');
  counts.researchRequests.push({body:init.body,bodyHash:crypto.createHash('sha256').update(init.body).digest('hex'),signed:!!encoded});save();
 }
 if(!encoded)return new Response('{}',{status:402,headers:{'PAYMENT-REQUIRED':Buffer.from(JSON.stringify({x402Version:2,resource:{url},accepts:[{scheme:'exact',network,asset:'0x3600000000000000000000000000000000000000',amount:'100000',payTo:process.env.KERYX_BUYER_PAYEE,maxTimeoutSeconds:691200,extra:{name:'GatewayWalletBatched',version:'1',verifyingContract:gateway}}]})).toString('base64')}});
 const signed=JSON.parse(Buffer.from(encoded,'base64').toString('utf8')),a=signed.payload.authorization;
 if(a.to.toLowerCase()!==process.env.KERYX_BUYER_PAYEE.toLowerCase()||a.value!=='100000')throw new Error('Wrong economic tuple');
 const recovered=await viem.recoverTypedDataAddress({domain:{name:'GatewayWalletBatched',version:'1',chainId:chain,verifyingContract:gateway},types:{TransferWithAuthorization:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}]},primaryType:'TransferWithAuthorization',message:{...a,value:BigInt(a.value),validAfter:BigInt(a.validAfter),validBefore:BigInt(a.validBefore)},signature:signed.payload.signature});
 if(recovered.toLowerCase()!==a.from.toLowerCase())throw new Error('Wrong synthetic signature');
 const queryId='a2a_'+crypto.createHash('sha256').update(['keryx-a2a-v2',network,a.from.toLowerCase(),a.to.toLowerCase(),a.nonce.toLowerCase()].join('|')).digest('hex');
 counts.paid++;save();
 if(process.env.TEST_MODE==='unknown')throw new Error('Synthetic paid-response loss');
 if(process.env.TEST_MODE==='presentation'){
  const vector=portVectors.find(vector=>vector.question===body.question);
  if(!vector)throw new Error('Unapproved presentation fixture question');
  const result={queryId,status:'completed',...publicResult,...reasoning,readCheckpoints:vector.readCheckpoints};
  counts.researchResults.push({queryId,resultHash:hash(result),serviceReceiptHash:hash(result.serviceReceipt),amountMicros:a.value});save();
  return Response.json(result,{headers:{'PAYMENT-RESPONSE':Buffer.from(JSON.stringify({success:true,network,payer:a.from,transaction:'synthetic-circle-settlement'})).toString('base64')}});
 }
 return Response.json({queryId,status:'completed',answer:'Synthetic cited answer',citations:[],creatorsPaid:0,totalToCreators:0,feePaid:0.05,...reasoning},{headers:{'PAYMENT-RESPONSE':Buffer.from(JSON.stringify({success:true,network,payer:a.from,transaction:'synthetic-circle-settlement'})).toString('base64')}});
};
`);
  let selectedNetwork = "arcTestnet";
  async function session(mode, journal, key = true) {
    const counts = join(workspace, `${selectedNetwork}-${mode}-counts.json`);
    const child = spawn(process.execPath, ["--require", mock, join(workspace, "node_modules/keryx-mcp/dist/keryx-mcp.mjs")], {
      cwd: workspace, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        HOME: workspace, USERPROFILE: workspace, TMP: workspace, TEMP: workspace,
        TEST_MODE: mode, TEST_COUNTS: counts, KERYX_NETWORK: selectedNetwork, NEXT_PUBLIC_KERYX_NETWORK: selectedNetwork,
 KERYX_BASE_URL: "https://synthetic.example", KERYX_BUYER_PAYEE: `0x${"22".repeat(20)}`,
        ...(key ? { KERYX_BUYER_PRIVATE_KEY: `0x${"11".repeat(32)}` } : {}),
        KERYX_WALLET_FILE: join(workspace, "forbidden-wallet.json"), KERYX_PAYMENT_JOURNAL: journal },
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.add(child); let stderr = "";
    child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-4096); });
    let serial = 0, failure; const pending = new Map();
    const failPending = reason => {
      failure = reason;
      for (const waiting of pending.values()) { clearTimeout(waiting.timer); waiting.reject(new Error(reason)); }
      pending.clear();
    };
    child.on("error", () => failPending(`Synthetic MCP child spawn failed: ${stderr}`));
    child.on("exit", (code, signal) => failPending(`Synthetic MCP child exited (${code ?? signal}): ${stderr}`));
    child.stdin.on("error", () => failPending(`Synthetic MCP child input closed: ${stderr}`));
    const lines = createInterface({ input: child.stdout });
    lines.on("line", line => {
      let message;
      try { message = JSON.parse(line); } catch { failPending("Synthetic MCP child emitted invalid protocol JSON"); return; }
      const waiting = pending.get(message.id);
      if (waiting) {
        clearTimeout(waiting.timer); pending.delete(message.id);
        message.error ? waiting.reject(new Error("Packaged MCP request failed")) : waiting.resolve(message.result);
      }
    });
    const request = (method, params) => new Promise((resolveResponse, reject) => {
      if (failure || exited(child)) { reject(new Error(failure ?? "Synthetic MCP child already exited")); return; }
      const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Packaged MCP ${method} timed out: ${stderr}`)); }, 30000);
      pending.set(id, { resolve: resolveResponse, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
    const initialized = await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "clean-package-acceptance", version: "1" } });
    assert.equal(initialized.serverInfo.version, expectedPackage.version);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const listed = await request("tools/list", {});
    for (const name of ["paper_lookup", "ask_keryx", "keryx_wallet_status", "keryx_recover", "keryx_operator_status"]) assert(listed.tools.some(tool => tool.name === name));
    assert.equal(listed.tools.find(tool => tool.name === "paper_lookup").annotations.readOnlyHint, true);
    assert.deepEqual(listed.tools.find(tool => tool.name === "paper_lookup").inputSchema.properties.language.enum, ["en", "fr", "vi"]);
    assert.equal(listed.tools.find(tool => tool.name === "ask_keryx").inputSchema.properties.question.maxLength, 2000);
    assert.deepEqual(listed.tools.find(tool => tool.name === "ask_keryx").inputSchema.properties.language.enum, ["en", "vi", "pt", "pt-BR", "es"]);
    return { call: (name, args = {}) => request("tools/call", { name, arguments: args }), counts,
      stop: async () => { await stopChild(child); children.delete(child); lines.close(); } };
  }
  for (selectedNetwork of ["arcTestnet", "arc"]) {
  const keyless = await session("keyless", join(workspace, `${selectedNetwork}-missing-payment.json`), false);
  const missing = await keyless.call("keryx_wallet_status"); assert.match(missing.content[0].text, /unconfigured/); assert.match(missing.content[0].text, /No wallet is created/);
  const invalidQuestion = await keyless.call("ask_keryx", { question: "x".repeat(2001) });
  assert(invalidQuestion.isError); assert.match(invalidQuestion.content[0].text, /2000/);
  const invalidLanguage = await keyless.call("ask_keryx", { question: "Reject unsupported research language before custody", language: "fr" });
  assert(invalidLanguage.isError); assert.match(invalidLanguage.content[0].text, /Input validation error.*ask_keryx/);
  assert.match(invalidLanguage.content[0].text, /language/);
  const metadata = await keyless.call("paper_lookup", { query: "https://arxiv.org/pdf/2005.11401v4.pdf" });
  assert(!metadata.isError); assert.equal(metadata.structuredContent.scope, "bibliography-only");
  assert.equal(metadata.structuredContent.groups[0].record.arxivId, "2005.11401v4");
  assert.match(metadata.content[0].text, /First listed author in the recorded complete list: First Author/);
  assert.match(metadata.content[0].text, /withdrawal\/replacement status: unknown/);
  assert.match(metadata.content[0].text, /eprint = \{2005\.11401v4\}/);
  assert.match(metadata.content[0].text, /AN  - arXiv:2005\.11401v4/);
  const frenchMetadata = await keyless.call("paper_lookup", { query: "2005.11401v4", language: "fr" });
  assert(!frenchMetadata.isError);
  assert.match(frenchMetadata.content[0].text, /Premier auteur dans la liste complète enregistrée: First Author/);
  assert.match(frenchMetadata.content[0].text, /Référence bibliographique courte/);
  assert.match(frenchMetadata.content[0].text, /Provenance des champs/);
  const unavailable = await keyless.call("paper_lookup", { query: "2005.11401v4", searchRepositories: true });
  assert(!unavailable.isError); assert.equal(unavailable.structuredContent.providers[0].status, "unavailable");
  assert.match(unavailable.content[0].text, /unavailable; no empty result inferred/);
  await keyless.stop();
  const metadataCounts = JSON.parse(await readFile(keyless.counts, "utf8"));
  assert.equal(metadataCounts.paid, 0); assert.equal(metadataCounts.rpc, 0);
  assert.equal(metadataCounts.bibliography, 3); assert.deepEqual(metadataCounts.bibliographyQueries, ["0", "0", "1"]);
  assert(!(await readdir(workspace)).some(name => /forbidden|missing-payment/.test(name)), "Missing custody created private state");
  const happy = await session("happy", join(workspace, `${selectedNetwork}-happy-payment.json`));
  const status = await happy.call("keryx_wallet_status"); assert.match(status.content[0].text, /ready:    yes/);
  const answer = await happy.call("ask_keryx", { question: "Synthetic package research".padEnd(2000, "x") }); assert(!answer.isError); assert.match(answer.content[0].text, /Synthetic cited answer/);
  assert.match(answer.content[0].text, /decide: heuristic \(heuristic; fallback served\)/);
  assert.equal(answer.structuredContent.reasoning.telemetry, "recorded");
  assert.deepEqual(answer.structuredContent.reasoning.sourceSelection,
    { step: "decide", state: "heuristic", servingEngines: ["heuristic"], fallbackUsed: true });
  assert(!('reasoningTelemetry' in answer.structuredContent)); assert(!('reasoningServing' in answer.structuredContent));
  assert.equal(answer.structuredContent.reasoningAttempts.find(attempt => attempt.step === "decide").engine, "heuristic");
  assert.equal(answer.structuredContent.reasoningAttempts.find(attempt => attempt.step === "synthesize").outputTokenLimit, 2560);
  assert.match(answer.content[0].text, /Model output limit reached: answer preparation \(2,560 tokens\)/);
  await happy.stop(); const happyCounts = JSON.parse(await readFile(happy.counts, "utf8")); assert.equal(happyCounts.paid, 1);
  const presentation = await session("presentation", join(workspace, `${selectedNetwork}-presentation-payment.json`));
  const presented = [];
  for (const [index, vector] of portVectors.entries()) {
    const result = await presentation.call("ask_keryx", { question: vector.question, budget: 0.05, language: vector.language });
    assert(!result.isError); const text = result.content[0].text, data = result.structuredContent;
    assert(text.startsWith(publicResult.answer + "\n\n"));
    if (vector.language === "vi") {
      assert.match(text, /Cấp phục vụ từng bước/); assert.match(text, /chuẩn bị câu trả lời \(2,560 tokens\)/);
      assert.match(text, /Thông tin tài chính \(tiếng Anh\):/);
      assert(text.includes("Ngôn ngữ nhãn: vi. Ngôn ngữ câu trả lời chưa được ghi nhận; văn bản gốc không thay đổi."));
    } else {
      assert.match(text, /Níveis de execução por etapa/); assert.match(text, /preparação da resposta \(2,560 tokens\)/);
      assert.match(text, /Informações financeiras \(em inglês\):/);
      assert(text.includes("Idioma dos rótulos: pt. O idioma da resposta não foi registrado; o texto original permanece inalterado."));
    }
    assert.match(text, /— Paid Keryx 0\.1 USDC/);
    assert.match(text, /Recorded creator total: \$0\.000001; citation allocations \(not individual settlement proof\):/);
    assert.match(text, /Exact synthetic source — \$0\.000001/);
    assert.equal(data.amountPaid, "0.1"); assert.equal(data.settlementId, "synthetic-circle-settlement");
    assert(!Object.hasOwn(data, "answerLanguage")); assert(!Object.hasOwn(data, "language"));
    assert.equal(data.answer, publicResult.answer); assert.deepEqual(data.evidence, publicResult.evidence);
    for (const [field, expected] of Object.entries(publicResult)) assert.deepEqual(data[field], expected);
    if (index < 2) assert.deepEqual(data.readCheckpoints, vector.readCheckpoints);
    else assert.deepEqual(data.readCheckpoints, { status: "unavailable" });
    for (const sentinel of privateSentinels) assert(!JSON.stringify(result).includes(sentinel), "Private checkpoint data escaped compiled buyer projection");
    presented.push(data);
  }
  await presentation.stop(); const presentationCounts = JSON.parse(await readFile(presentation.counts, "utf8"));
  assert.equal(presentationCounts.paid, 3); assert.equal(presentationCounts.recovery, 0); assert.equal(presentationCounts.bibliography, 0);
  assert.equal(presentationCounts.researchRequests.length, 6); assert.equal(presentationCounts.researchResults.length, 3);
  for (const [index, vector] of portVectors.entries()) {
    const body = { question: vector.question, budget: 0.05, researchMode: "deep", responseMode: "async" };
    assert.deepEqual(presentationCounts.researchRequests.slice(index * 2, index * 2 + 2),
      [false, true].map(signed => ({ body: JSON.stringify(body), bodyHash: hash(body), signed })));
    const { settlementId, amountPaid, ...projected } = presented[index];
    assert.equal(settlementId, "synthetic-circle-settlement"); assert.equal(amountPaid, "0.1");
    const originalResult = { ...projected, readCheckpoints: vector.readCheckpoints };
    assert.equal(hash(originalResult), presentationCounts.researchResults[index].resultHash, "Non-checkpoint public result bytes changed");
    assert.equal(hash(projected.serviceReceipt), presentationCounts.researchResults[index].serviceReceiptHash);
    assert.equal(presentationCounts.researchResults[index].amountMicros, "100000");
  }
  const journal = join(workspace, `${selectedNetwork}-unknown-payment.json`), unknown = await session("unknown", journal);
  assert((await unknown.call("ask_keryx", { question: "Synthetic response-loss research" })).isError);
  const original = JSON.parse(await readFile(journal, "utf8")); assert.equal(original.status, "unconfirmed");
  assert((await unknown.call("ask_keryx", { question: "Must not pay twice" })).isError); await unknown.stop();
  const unknownCounts = JSON.parse(await readFile(unknown.counts, "utf8")); assert.equal(unknownCounts.paid, 1);
  const recovery = await session("recovery", journal, false);
  const recovered = await recovery.call("keryx_recover"); assert(!recovered.isError); assert.match(recovered.content[0].text, /Recovered original synthetic answer/);
  assert.match(recovered.content[0].text, /"telemetry": "recorded"/);
  await recovery.stop(); const recoveryCounts = JSON.parse(await readFile(recovery.counts, "utf8")); assert.equal(recoveryCounts.paid, 0); assert.equal(recoveryCounts.recovery, 1);
  }
  console.log(JSON.stringify({ networks: ["arcTestnet", "arc"], package: installedPackage.name, version: installedPackage.version, node: process.version,
    dependencies, cases: ["keyless initialize/tools/status without wallet creation", "free exact-version bibliography GET and explicit provider failure with retained snapshot", "funded caller status", "actual SDK signed purchase", "recorded per-step heuristic tier", "finite research language refusal before custody", "local stdio labels with unchanged paid body, evidence, amounts and receipt hashes", "compiled v3 available, partial optimizer and private-field refusal", "original response-loss barrier and no second debit", "new-process keyless GET-only recovery"], liveNetwork: false }));
} finally {
  const stopped = await Promise.allSettled([...children].map(stopChild));
  // Only the mkdtemp-created acceptance workspace is removed.
  assert(workspace.startsWith(join(tmpdir(), "keryx-mcp-consumer-")));
  await rm(workspace, { recursive: true, force: true });
  for (const result of stopped) if (result.status === "rejected") throw result.reason;
}
