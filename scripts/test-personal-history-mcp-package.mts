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
const url=new URL(raw);if(url.origin!=='https://synthetic.example'||url.pathname!=='/api/me/history'||init.method!=='GET'||init.redirect!=='error'||init.credentials!=='omit'||init.headers.Authorization!=='Bearer '+process.env.KERYX_API_KEY)throw Error('Unexpected transport');
calls.push({url:String(url),method:init.method});writeFileSync(${JSON.stringify(records)},JSON.stringify(calls));
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
  } finally { await client.close(); }
  assert(!(await readdir(directory)).some(file => file.startsWith("forbidden-")));
  console.log("Personal history built stdio accepted: bounded fixed HTTPS key-only reads, no research/payment/custody/discovery leakage. Installed closure only; not publication or live backend proof.");
} finally { await rm(directory, { recursive: true, force: true }); }
