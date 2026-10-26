/** Current built local stdio artifact; no installation, provider or spending. */
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { literatureBackupFixture } from "../test-support/literature-backup-fixture";
import { serializeLiteratureWorkspace } from "../lib/papers/literature-workspace";
import { exportLiterature } from "../lib/papers/literature-export";

const temporary = await mkdtemp(join(tmpdir(), "keryx-library-mcp-"));
assert(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
const bootstrap = join(temporary, "forbid-network.mjs"), attempted = join(temporary, "forbidden-network.txt");
await writeFile(bootstrap, `import {writeFileSync} from 'node:fs';globalThis.fetch=async()=>{writeFileSync(${JSON.stringify(attempted)},'attempt');throw new Error('No network allowed');};`);
try {
  for (const network of ["arcTestnet", "arc"]) {
    const transport = new StdioClientTransport({ command: process.execPath,
      args: ["--import", pathToFileURL(bootstrap).href, resolve("mcp/dist/keryx-mcp.mjs")],
      env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", KERYX_BASE_URL: "https://synthetic.example",
        KERYX_NETWORK: network, NEXT_PUBLIC_KERYX_NETWORK: network, KERYX_WALLET_FILE: join(temporary, "forbidden-wallet.json"),
        KERYX_PAYMENT_JOURNAL: join(temporary, "forbidden-payment.json") }, stderr: "pipe" });
    const client = new Client({ name: "library-export-distribution-test", version: "1" });
    try {
      await client.connect(transport);
      const tool = (await client.listTools()).tools.find(tool => tool.name === "export_saved_literature")!;
      assert(tool); assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
      assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), ["backup", "format", "paperUrls", "screening"]);
      for (const format of ["bibtex", "ris", "csl-json"] as const) {
        const input = { backup: serializeLiteratureWorkspace(literatureBackupFixture()), format, screening: "include" as const };
        const result = await client.callTool({ name: tool.name, arguments: input });
        assert(!result.isError); assert.deepEqual(result.structuredContent, exportLiterature(input));
        assert(!JSON.stringify(result).includes("PRIVATE_"));
        const paperUrls = literatureBackupFixture().entries.map(entry => entry.paper.url).reverse();
        for (const selection of [paperUrls, [paperUrls[0]], []]) {
          const selectedInput = { backup: input.backup, format, paperUrls: selection };
          const selected = await client.callTool({ name: tool.name, arguments: selectedInput });
          assert(!selected.isError); assert.deepEqual(selected.structuredContent, exportLiterature(selectedInput));
          assert(!JSON.stringify(selected).includes("PRIVATE_"));
        }
      }
      const missing = await client.callTool({ name: tool.name, arguments: {
        backup: serializeLiteratureWorkspace(literatureBackupFixture()), format: "ris", paperUrls: ["https://arxiv.org/abs/PRIVATE_NOT_SAVED"] } });
      assert(missing.isError); assert(!missing.structuredContent); assert(!JSON.stringify(missing).includes("PRIVATE_NOT_SAVED"));
      const bad = await client.callTool({ name: tool.name, arguments: { backup: "PRIVATE_MALFORMED_BACKUP", format: "ris" } });
      assert(bad.isError); assert(!bad.structuredContent); assert(!JSON.stringify(bad).includes("PRIVATE_MALFORMED_BACKUP"));
    } finally { await client.close(); }
  }
  assert(!(await readdir(temporary)).some(name => name.startsWith("forbidden-")));
  console.log("PASS built local stdio literature export on both synthetic profiles: exact shared references, private review fields omitted, zero fetch/wallet/payment access.");
} finally { await rm(temporary, { recursive: true, force: true }); }
