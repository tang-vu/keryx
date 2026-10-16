/** Exercise the actual bundled stdio transport with synthetic hosted HTTP only. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const temporary = await mkdtemp(join(tmpdir(), "keryx-sponsored-mcp-"));
assert(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
const bootstrap = join(temporary, "http.mjs");
const countPath = join(temporary, "calls.json");
const queryId = "12345678-1234-4234-8234-123456789abc";
await writeFile(bootstrap, `
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
let calls=0;
globalThis.fetch=async(url,init)=>{
 assert.equal(String(url),'https://synthetic.example/api/v1/chat/completions');
 assert.equal(init.method,'POST'); assert.equal(init.redirect,'error'); assert.equal(init.credentials,'omit');
 const headers=new Headers(init.headers);
 assert.equal(headers.get('Authorization'),'Bearer keryx');
 assert(!JSON.stringify([...headers]).includes('FORBIDDEN_LOCAL_KEY'));
 const body=JSON.parse(init.body), question=body.messages[0].content;
 assert.equal(body.stream,true); assert.equal(body.budget,0);
 calls++; writeFileSync(${JSON.stringify(countPath)},JSON.stringify({calls}));
 if(question.includes('quota'))return Response.json({error:'sponsored_rate_limit',retryAfter:17},{status:429,headers:{'Retry-After':'17'}});
 if(question.includes('pause'))return Response.json({error:{code:'research_paused',message:'Fixture pause'}},{status:503});
 const chunk=(value)=>'data: '+JSON.stringify(value)+'\\n\\n';
 const answer=chunk({choices:[{delta:{content:'Synthetic hosted answer [S1].'},finish_reason:null}]});
 if(question.includes('truncated'))return new Response(answer,{headers:{'Content-Type':'text/event-stream'}});
 const metadata={queryId:${JSON.stringify(queryId)},dispatchUrl:'https://synthetic.example/dispatch/'+${JSON.stringify(queryId)},citations:[{sourceName:'Fixture source',sourceUrl:'https://source.example/paper',marker:'[S1]'}],totalToCreators:0};
 return new Response(answer+chunk({choices:[{delta:{},finish_reason:'stop'}],keryx:metadata,keryx_private:{ticket:'FORBIDDEN_PRIVATE_TICKET'}})+'data: [DONE]\\n\\n',{headers:{'Content-Type':'text/event-stream'}});
};
`);
try {
  for (const network of ["arcTestnet", "arc"]) {
    const transport = new StdioClientTransport({ command: process.execPath,
      args: ["--import", pathToFileURL(bootstrap).href, resolve("mcp/dist/keryx-mcp.mjs")],
      env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "",
        KERYX_BASE_URL: "https://synthetic.example", KERYX_API_KEY: "FORBIDDEN_LOCAL_KEY",
        KERYX_NETWORK: network, NEXT_PUBLIC_KERYX_NETWORK: network,
        KERYX_WALLET_FILE: join(temporary, "forbidden-wallet.json"),
        KERYX_PAYMENT_JOURNAL: join(temporary, "forbidden-payment.json") }, stderr: "pipe" });
    const client = new Client({ name: "sponsored-distribution-test", version: "1" });
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools;
      assert(tools.some(tool => tool.name === "ask_keryx"), "Existing paid tool remains available");
      assert(tools.some(tool => tool.name === "ask_keryx_sponsored"));
      const invalid = await client.callTool({ name: "ask_keryx_sponsored", arguments: { question: "Missing public intent" } });
      assert.equal(invalid.isError, true);
      for (const kind of ["success", "quota", "pause", "truncated"]) {
        const result = await client.callTool({ name: "ask_keryx_sponsored",
          arguments: { question: `Synthetic ${kind} question`, publicReport: true, mode: "quick", budget: 0 } });
        const serialized = JSON.stringify(result);
        assert(!serialized.includes("FORBIDDEN_PRIVATE_TICKET"));
        assert(!serialized.includes("FORBIDDEN_LOCAL_KEY"));
        if (kind === "success") {
          assert(!result.isError, serialized);
          assert(serialized.includes("Synthetic hosted answer [S1]."));
          assert(serialized.includes(`/dispatch/${queryId}`));
        } else assert.equal(result.isError, true, kind);
      }
      assert.equal(JSON.parse(await readFile(countPath, "utf8")).calls, 4, "One POST per explicit valid submission; no retries");
    } finally { await client.close(); }
  }
  assert(!(await readdir(temporary)).some(name => name.startsWith("forbidden-")), "Sponsored calls must not create custody or payment journals");
  console.log("PASS bundled stdio sponsored research on both profiles: explicit public intent, zero budget, anonymous headers, quota/pause/truncation, no retry or custody writes.");
} finally { await rm(temporary, { recursive: true, force: true }); }
