/** Current built stdio bytes and installed closure; no fresh-install acceptance claim. */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const temporary = await mkdtemp(join(tmpdir(), "keryx-paper-mcp-"));
assert(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
const bootstrap = join(temporary, "http.mjs"), counts = join(temporary, "counts.json");
await writeFile(bootstrap, `import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
let calls=0;
globalThis.fetch=async(url,init)=>{
 if(String(url)!=='https://synthetic.example/api/papers?q=2005.11401v4'||init.method!=='GET'||init.headers||init.body)throw new Error('Unexpected metadata HTTP');
 calls++;writeFileSync(${JSON.stringify(counts)},JSON.stringify({calls}));
 const record={title:'Frozen exact metadata',authors:['First Author','Second Author','Third Author'],authorCount:3,authorsTruncated:false,
 arxivId:'2005.11401v4',repository:'arxiv',url:'https://arxiv.org/abs/2005.11401v4',metadataUrl:'https://export.arxiv.org/api/query?id_list=2005.11401v4',
 metadataObservedAt:'2026-10-06T00:00:00.000Z',publicationKind:'preprint',peerReview:'unknown'};
 return Response.json({version:1,scope:'bibliography-only',groups:[{id:'paper:'+createHash('sha256').update('2005.11401').digest('hex'),record,records:[record]}],totalWorks:1,catalogRecords:1,providers:[]});
};`);
try {
  for (const network of ["arcTestnet", "arc"]) {
    const transport = new StdioClientTransport({ command: process.execPath,
      args: ["--import", pathToFileURL(bootstrap).href, resolve("mcp/dist/keryx-mcp.mjs")],
      env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", KERYX_BASE_URL: "https://synthetic.example",
        KERYX_NETWORK: network, NEXT_PUBLIC_KERYX_NETWORK: network, KERYX_WALLET_FILE: join(temporary, "forbidden-wallet.json"),
        KERYX_PAYMENT_JOURNAL: join(temporary, "forbidden-payment.json") }, stderr: "pipe" });
    const client = new Client({ name: "bibliography-distribution-test", version: "1" });
    try {
      await client.connect(transport);
      const tools = await client.listTools(), lookup = tools.tools.find(tool => tool.name === "paper_lookup")!;
      assert.deepEqual((lookup.inputSchema.properties?.language as { enum: string[] }).enum, ["en", "fr", "vi"]);
      const result = await client.callTool({ name: "paper_lookup", arguments: { query: "2005.11401v4", language: "fr" } });
      assert(!result.isError);
      const text = (result.content as Array<{ text: string }>)[0].text;
      for (const value of ["Titre: Frozen exact metadata", "1. First Author; 2. Second Author; 3. Third Author", "Provenance des champs",
        "Référence bibliographique courte", "eprint = {2005.11401v4}", "AN  - arXiv:2005.11401v4", "aucune lecture du texte intégral"])
        assert(text.includes(value), `Missing ${value}`);
      const data = result.structuredContent as Record<string, unknown>;
      assert.equal(data.scope, "bibliography-only");
      for (const authority of ["citations", "researchExports", "payments", "payTo"]) assert(!(authority in data));
      assert.equal(JSON.parse(await readFile(counts, "utf8")).calls, 1);
    } finally { await client.close(); }
  }
  assert(!(await readdir(temporary)).some(name => name.startsWith("forbidden-")));
  console.log("PASS current built stdio bibliography on both synthetic profiles: keyless GET, French card, exact version, provenance and BibTeX/RIS; no fresh install, live provider, research, custody or payment.");
} finally { await rm(temporary, { recursive: true, force: true }); }
