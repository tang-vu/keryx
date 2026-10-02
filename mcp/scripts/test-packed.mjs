import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
  const mock = join(workspace, "synthetic-network.cjs");
  await writeFile(mock, `
const fs=require('node:fs'), crypto=require('node:crypto'), viem=require('viem');
const counts={paid:0,rpc:0,recovery:0};
const save=()=>fs.writeFileSync(process.env.TEST_COUNTS,JSON.stringify(counts));
const deny=()=>{throw new Error('Live network forbidden in package acceptance');};
for(const name of ['node:http','node:https']){const m=require(name);m.request=deny;m.get=deny;}
const net=require('node:net');net.connect=deny;net.createConnection=deny;net.Socket.prototype.connect=deny;
globalThis.fetch=async(input,init)=>{
 const url=String(input),body=init?.body?JSON.parse(init.body):null;
 if(process.env.TEST_MODE==='keyless')throw new Error('No network allowed for missing custody');
 if(body?.jsonrpc==='2.0'){
  counts.rpc++;save();let result;
  if(body.method==='eth_chainId')result='0x4cef52';
  else if(body.method==='eth_getBalance')result='0xde0b6b3a7640000';
  else if(body.method==='eth_call')result='0x'+(1000000n).toString(16).padStart(64,'0');
  else throw new Error('Unexpected RPC '+body.method);
  return Response.json({jsonrpc:'2.0',id:body.id,result});
 }
 if(url==='https://gateway-api-testnet.circle.com/v1/balances')return Response.json({token:'USDC',balances:[{depositor:body.sources[0].depositor,domain:26,balance:'1'}]});
 if(url.startsWith('https://synthetic.example/api/agent/ask?queryId=')){
  counts.recovery++;save();const queryId=new URL(url).searchParams.get('queryId');
  return Response.json({queryId,status:'completed',answer:'Recovered original synthetic answer',citations:[],creatorsPaid:0,totalToCreators:0,feePaid:0.05});
 }
 if(url!=='https://synthetic.example/api/agent/ask')throw new Error('Unapproved synthetic destination');
 const encoded=init.headers['Payment-Signature'];
 if(!encoded)return new Response('{}',{status:402,headers:{'PAYMENT-REQUIRED':Buffer.from(JSON.stringify({x402Version:2,resource:{url},accepts:[{scheme:'exact',network:'eip155:5042002',asset:'0x3600000000000000000000000000000000000000',amount:'100000',payTo:process.env.KERYX_BUYER_PAYEE,maxTimeoutSeconds:691200,extra:{name:'GatewayWalletBatched',version:'1',verifyingContract:'0x0077777d7EBA4688BDeF3E311b846F25870A19B9'}}]})).toString('base64')}});
 const signed=JSON.parse(Buffer.from(encoded,'base64').toString('utf8')),a=signed.payload.authorization;
 if(a.to.toLowerCase()!==process.env.KERYX_BUYER_PAYEE.toLowerCase()||a.value!=='100000')throw new Error('Wrong economic tuple');
 const recovered=await viem.recoverTypedDataAddress({domain:{name:'GatewayWalletBatched',version:'1',chainId:5042002,verifyingContract:'0x0077777d7EBA4688BDeF3E311b846F25870A19B9'},types:{TransferWithAuthorization:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}]},primaryType:'TransferWithAuthorization',message:{...a,value:BigInt(a.value),validAfter:BigInt(a.validAfter),validBefore:BigInt(a.validBefore)},signature:signed.payload.signature});
 if(recovered.toLowerCase()!==a.from.toLowerCase())throw new Error('Wrong synthetic signature');
 const queryId='a2a_'+crypto.createHash('sha256').update(['keryx-a2a-v2','eip155:5042002',a.from.toLowerCase(),a.to.toLowerCase(),a.nonce.toLowerCase()].join('|')).digest('hex');
 counts.paid++;save();
 if(process.env.TEST_MODE==='unknown')throw new Error('Synthetic paid-response loss');
 return Response.json({queryId,status:'completed',answer:'Synthetic cited answer',citations:[],creatorsPaid:0,totalToCreators:0,feePaid:0.05},{headers:{'PAYMENT-RESPONSE':Buffer.from(JSON.stringify({success:true,network:'eip155:5042002',payer:a.from,transaction:'synthetic-circle-settlement'})).toString('base64')}});
};
`);
  async function session(mode, journal, key = true) {
    const counts = join(workspace, `${mode}-counts.json`);
    const child = spawn(process.execPath, ["--require", mock, join(workspace, "node_modules/keryx-mcp/dist/keryx-mcp.mjs")], {
      cwd: workspace, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        HOME: workspace, USERPROFILE: workspace, TMP: workspace, TEMP: workspace,
        TEST_MODE: mode, TEST_COUNTS: counts, KERYX_BASE_URL: "https://synthetic.example", KERYX_BUYER_PAYEE: `0x${"22".repeat(20)}`,
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
    assert.equal(initialized.serverInfo.version, "0.3.0");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const listed = await request("tools/list", {});
    for (const name of ["ask_keryx", "keryx_wallet_status", "keryx_recover"]) assert(listed.tools.some(tool => tool.name === name));
    return { call: (name, args = {}) => request("tools/call", { name, arguments: args }), counts,
      stop: async () => { await stopChild(child); children.delete(child); lines.close(); } };
  }
  const keyless = await session("keyless", join(workspace, "missing-payment.json"), false);
  const missing = await keyless.call("keryx_wallet_status"); assert.match(missing.content[0].text, /unconfigured/); assert.match(missing.content[0].text, /No wallet is created/);
  await keyless.stop();
  assert(!(await readdir(workspace)).some(name => /forbidden|missing-payment/.test(name)), "Missing custody created private state");
  const happy = await session("happy", join(workspace, "happy-payment.json"));
  const status = await happy.call("keryx_wallet_status"); assert.match(status.content[0].text, /ready:    yes/);
  const answer = await happy.call("ask_keryx", { question: "Synthetic package research" }); assert(!answer.isError); assert.match(answer.content[0].text, /Synthetic cited answer/);
  await happy.stop(); const happyCounts = JSON.parse(await readFile(happy.counts, "utf8")); assert.equal(happyCounts.paid, 1);
  const journal = join(workspace, "unknown-payment.json"), unknown = await session("unknown", journal);
  assert((await unknown.call("ask_keryx", { question: "Synthetic response-loss research" })).isError);
  const original = JSON.parse(await readFile(journal, "utf8")); assert.equal(original.status, "unconfirmed");
  assert((await unknown.call("ask_keryx", { question: "Must not pay twice" })).isError); await unknown.stop();
  const unknownCounts = JSON.parse(await readFile(unknown.counts, "utf8")); assert.equal(unknownCounts.paid, 1);
  const recovery = await session("recovery", journal, false);
  const recovered = await recovery.call("keryx_recover"); assert(!recovered.isError); assert.match(recovered.content[0].text, /Recovered original synthetic answer/);
  await recovery.stop(); const recoveryCounts = JSON.parse(await readFile(recovery.counts, "utf8")); assert.equal(recoveryCounts.paid, 0); assert.equal(recoveryCounts.recovery, 1);
  console.log(JSON.stringify({ package: installedPackage.name, version: installedPackage.version, node: process.version,
    dependencies, cases: ["keyless initialize/tools/status without wallet creation", "funded caller status", "actual SDK signed purchase", "original response-loss barrier and no second debit", "new-process keyless GET-only recovery"], liveNetwork: false }));
} finally {
  const stopped = await Promise.allSettled([...children].map(stopChild));
  // Only the mkdtemp-created acceptance workspace is removed.
  assert(workspace.startsWith(join(tmpdir(), "keryx-mcp-consumer-")));
  await rm(workspace, { recursive: true, force: true });
  for (const result of stopped) if (result.status === "rejected") throw result.reason;
}
