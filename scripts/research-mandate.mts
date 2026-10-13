import { open } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMandateMcpServer } from "../lib/research-mandate/mcp";
import { mandateExample } from "../lib/research-mandate/example";
import { evaluateMandate } from "../lib/research-mandate/evaluate";
import { MAX_MANDATE_BYTES } from "../lib/research-mandate/http";

const args = process.argv.slice(2);
try {
  if (args.length === 1 && args[0] === "--mcp") {
    await createMandateMcpServer().connect(new StdioServerTransport());
  } else if (args.length === 1 && args[0] === "--example") {
    process.stdout.write(JSON.stringify(mandateExample(), null, 2) + "\n");
  } else if (args.length === 2 && args[0] === "--input") {
    const file = await open(args[1], "r");
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_MANDATE_BYTES) throw new Error("Input must be a regular JSON file of at most 64 KiB");
      const buffer = Buffer.alloc(MAX_MANDATE_BYTES + 1);
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await file.read(buffer, total, buffer.length - total, null);
        if (!bytesRead) break; total += bytesRead;
      }
      if (total > MAX_MANDATE_BYTES) throw new Error("Input exceeds 64 KiB");
      const input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, total)));
      process.stdout.write(JSON.stringify(evaluateMandate(input), null, 2) + "\n");
    } finally { await file.close(); }
  } else throw new Error("Usage: node --import tsx scripts/research-mandate.mts --example | --input <file.json> | --mcp");
} catch {
  // Never print user file contents or private paths on a parse/validation failure.
  process.stderr.write("Mandate request failed. Use --example, --input <JSON file up to 64 KiB>, or --mcp. No execution was authorized.\n");
  process.exitCode = 1;
}
