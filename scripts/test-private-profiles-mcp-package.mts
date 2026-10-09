/** Exact built stdio package + installed dependency closure, synthetic HTTPS transport only. */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
const directory = await mkdtemp(join(tmpdir(), "keryx-profile-mcp-")); assert(resolve(directory).startsWith(resolve(tmpdir()) + sep));
const bootstrap = join(directory, "transport.mjs"), records = join(directory, "requests.json"), owner = `0x${"a".repeat(40)}`;
await writeFile(bootstrap, `import{writeFileSync}from'node:fs';const calls=[];globalThis.fetch=async(url,init)=>{
const identityRead=String(url)==='https://synthetic.example/api/me/profile/identities';
if((!identityRead&&String(url)!=='https://synthetic.example/api/me/profile')||!(identityRead?init.method==='GET'&&!init.body:['GET','PUT'].includes(init.method))||init.redirect!=='error'||init.credentials!=='omit'||init.cache!=='no-store'||init.headers.Authorization!=='Bearer '+process.env.KERYX_API_KEY)throw Error('Unexpected transport');
calls.push({url:String(url),method:init.method});writeFileSync(${JSON.stringify(records)},JSON.stringify(calls));
if(identityRead)return Response.json({wallet:${JSON.stringify(owner)},identities:[{wallet:${JSON.stringify(owner)},provider:'github',externalId:'123',label:'fixture-user',verifiedAt:'2026-10-09T00:00:00.000Z'},{wallet:${JSON.stringify(owner)},provider:'orcid',externalId:'0000-0002-1825-0097',label:'Fixture Researcher',verifiedAt:'2026-10-09T00:00:00.000Z'}]});
const profile=init.method==='PUT'?JSON.parse(init.body):{displayName:'Synthetic private owner',handle:'reader_01',bio:'Reader',purpose:'Papers',links:[]};
const row={...profile,wallet:${JSON.stringify(owner)},createdAt:'2026-10-08T00:00:00.000Z',updatedAt:'2026-10-08T00:00:00.000Z'};
return Response.json(init.method==='PUT'?{profile:row}:{profile:row,activity:{firstSeenAt:null,questions:1201,surfacesUsed:['web'],topics:[],creatorsPaid:1,scope:'attributed-current-store',network:'eip155:5042'}});};`);
try {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", pathToFileURL(bootstrap).href, resolve("mcp/dist/keryx-mcp.mjs")],
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", KERYX_BASE_URL: "https://synthetic.example", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_API_KEY: `kx_live_${"1".repeat(96)}`,
      KERYX_WALLET_FILE: join(directory, "forbidden-wallet.json"), KERYX_PAYMENT_JOURNAL: join(directory, "forbidden-payment.json") }, stderr: "pipe" });
  const client = new Client({ name: "profile-distribution-fixture", version: "1" });
  try {
    await client.connect(transport); const tools = await client.listTools(); assert(tools.tools.some(tool => tool.name === "profile_read")); assert(tools.tools.some(tool => tool.name === "profile_update")); assert(!JSON.stringify(tools).includes("Synthetic private owner"));
    const identityTool = tools.tools.find(tool => tool.name === "profile_identities_read"); assert(identityTool); assert.equal(identityTool.annotations?.readOnlyHint, true); assert.equal(identityTool.inputSchema.additionalProperties, false);
    assert(!JSON.stringify(tools).includes("fixture-user")); assert.deepEqual(tools.tools.filter(tool => tool.name.startsWith("profile_identities_")).map(tool => tool.name), ["profile_identities_read"]);
    const read = await client.callTool({ name: "profile_read", arguments: {} }); assert(!read.isError); assert.equal((read.structuredContent as { profile: { wallet: string } }).profile.wallet, owner);
    const input = { displayName: "Replaced", handle: "reader_01", bio: "Reader", purpose: "Papers", links: [] };
    const updated = await client.callTool({ name: "profile_update", arguments: { profile: input } }); assert(!updated.isError); assert(updated.structuredContent && typeof updated.structuredContent === "object"); assert(!("activity" in (updated.structuredContent as Record<string, unknown>))); assert.equal((updated.structuredContent as { profile: { displayName: string } }).profile.displayName, "Replaced");
    const refused = await client.callTool({ name: "profile_identities_read", arguments: { wallet: `0x${"b".repeat(40)}` } }); assert(refused.isError);
    const identities = await client.callTool({ name: "profile_identities_read", arguments: {} }); assert(!identities.isError);
    assert.deepEqual(identities.structuredContent, { wallet: owner, identities: [
      { wallet: owner, provider: "github", externalId: "123", label: "fixture-user", verifiedAt: "2026-10-09T00:00:00.000Z" },
      { wallet: owner, provider: "orcid", externalId: "0000-0002-1825-0097", label: "Fixture Researcher", verifiedAt: "2026-10-09T00:00:00.000Z" },
    ] });
    assert.deepEqual(JSON.parse(await readFile(records, "utf8")), [
      { url: "https://synthetic.example/api/me/profile", method: "GET" }, { url: "https://synthetic.example/api/me/profile", method: "PUT" },
      { url: "https://synthetic.example/api/me/profile/identities", method: "GET" },
    ]);
  } finally { await client.close(); }
  assert(!(await readdir(directory)).some(file => file.startsWith("forbidden-")));
  console.log("Private profile built stdio acceptance passed: unchanged profile read/update plus strict owner identities read, fixed synthetic HTTPS bearer requests, no OAuth mutations/retries/research/custody/payment, no discovery leakage. Installed closure only; not fresh install, provider consent or live backend acceptance.");
} finally { await rm(directory, { recursive: true, force: true }); }
