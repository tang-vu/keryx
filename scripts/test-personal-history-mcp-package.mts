/** Exact built stdio artifact with fixed synthetic HTTPS only; no custody or app backend. */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
const directory = await mkdtemp(join(tmpdir(), "keryx-history-mcp-")); assert(resolve(directory).startsWith(resolve(tmpdir()) + sep));
const bootstrap = join(directory, "transport.mjs"), records = join(directory, "requests.json"), owner = `0x${"a".repeat(40)}`;
await writeFile(bootstrap, `import{writeFileSync}from'node:fs';const calls=[];globalThis.fetch=async(raw,init)=>{
const url=new URL(raw);if(url.origin!=='https://synthetic.example'||!['/api/me/history','/api/me/asks','/api/me/asks/export'].includes(url.pathname)||init.method!=='GET'||init.redirect!=='error'||init.credentials!=='omit'||init.headers.Authorization!=='Bearer '+process.env.KERYX_API_KEY||url.searchParams.has('wallet'))throw Error('Unexpected transport');
calls.push({url:String(url),method:init.method});writeFileSync(${JSON.stringify(records)},JSON.stringify(calls));
if(url.searchParams.get('cursor')==='revoked')return Response.json({error:'unauthenticated'},{status:401});
if(url.pathname==='/api/me/asks')return Response.json({version:2,wallet:${JSON.stringify(owner)},scope:'wallet-owned-current-store',storeNetwork:'eip155:5042002',rows:[],nextCursor:null,scanLimited:false,claimsAvailable:true,membershipAvailable:false});
if(url.pathname==='/api/me/asks/export')return Response.json({version:2,wallet:${JSON.stringify(owner)},scope:'wallet-owned-current-store',rows:[],complete:true,truncated:false,nextCursor:null,bounds:{maxPages:20,maxRows:1000,maxBytes:2097152},pages:1,claimsAvailable:true,membershipAvailable:false,qualification:'Synthetic bounded current-store metadata; not account membership or production acceptance.'});
return Response.json({version:1,wallet:${JSON.stringify(owner)},scope:'attributed-current-store',storeNetwork:'eip155:5042002',rows:[],nextCursor:url.searchParams.has('cursor')?null:'synthetic_cursor'});};`);
try {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", pathToFileURL(bootstrap).href, resolve("mcp/dist/keryx-mcp.mjs")],
    env: { PATH: process.env.PATH ?? process.env.Path ?? "", SystemRoot: process.env.SystemRoot ?? "", KERYX_BASE_URL: "https://synthetic.example", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_API_KEY: `kx_live_${"1".repeat(96)}`,
      KERYX_WALLET_FILE: join(directory, "forbidden-wallet.json"), KERYX_PAYMENT_JOURNAL: join(directory, "forbidden-payment.json") }, stderr: "pipe" });
  const client = new Client({ name: "history-distribution-fixture", version: "1" });
  try {
    await client.connect(transport); const tools = await client.listTools(); const tool = tools.tools.find(item => item.name === "history_read"); assert(tool);
    assert(!("wallet" in (tool.inputSchema.properties ?? {}))); assert(!JSON.stringify(tools).includes(owner));
    const first = await client.callTool({ name: "history_read", arguments: { search: "%_", surface: "api", limit: 3 } });
    assert(!first.isError); assert.equal((first.structuredContent as { wallet: string }).wallet, owner);
    const next = await client.callTool({ name: "history_read", arguments: { search: "%_", surface: "api", limit: 3, cursor: "synthetic_cursor" } }); assert(!next.isError);
    const invalid = await client.callTool({ name: "history_read", arguments: { limit: 51 } }); assert(invalid.isError);
    const calls = JSON.parse(await readFile(records, "utf8")); assert.equal(calls.length, 2);
    assert(calls.every((call: { method: string }) => call.method === "GET")); assert.equal(new URL(calls[0].url).searchParams.get("search"), "%_"); assert.equal(new URL(calls[1].url).searchParams.get("cursor"), "synthetic_cursor");
    for (const name of ["history_owned_read", "history_export"]) {
      const ownedTool = tools.tools.find(item => item.name === name); assert(ownedTool);
      assert(!("wallet" in (ownedTool.inputSchema.properties ?? {})));
      const owned = await client.callTool({ name, arguments: { search: "%_", visibility: "private", surface: "api" } });
      assert(!owned.isError); assert.equal((owned.structuredContent as { version: number; wallet: string }).version, 2);
      assert.equal((owned.structuredContent as { wallet: string }).wallet, owner);
      const refused = await client.callTool({ name, arguments: { cursor: "revoked" } });
      assert(refused.isError); assert.equal(refused.structuredContent, undefined);
      assert(!JSON.stringify(refused).includes(owner)); assert(!JSON.stringify(refused).includes(`kx_live_${"1".repeat(96)}`));
      assert((await client.callTool({ name, arguments: { wallet: owner } })).isError);
      assert((await client.callTool({ name, arguments: { language: "vi" } })).isError, "Research presentation language does not widen history input");
    }
    const finalCalls = JSON.parse(await readFile(records, "utf8")) as Array<{ method: string; url: string }>;
    assert.equal(finalCalls.length, 6); assert(finalCalls.every(call => call.method === "GET"));
    assert(!JSON.stringify(finalCalls).includes(`kx_live_${"1".repeat(96)}`));
  } finally { await client.close(); }
  assert(!(await readdir(directory)).some(file => file.startsWith("forbidden-")));
  console.log("Personal history built stdio v1/v2/read/export accepted: bounded fixed HTTPS key-only reads, refused revocation/owner/language selectors, no research/payment/custody leakage. Built closure only; not publication or live backend proof.");
} finally { await rm(directory, { recursive: true, force: true }); }
