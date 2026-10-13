import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mandateExample } from "./example";
import { evaluateMandate } from "./evaluate";

const script = resolve("scripts/research-mandate.mts");
const cleanEnv: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["PATH", "Path", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"])
  if (process.env[key]) cleanEnv[key] = process.env[key]!;
const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", script, ...args], { encoding: "utf8", env: cleanEnv, timeout: 10_000, windowsHide: true });
describe("local CLI and stdio mandate assessment", () => {
  it("runs with no credentials and refuses malformed/oversized input without echoing private file content", () => {
    const example = run("--example"); expect(example.status).toBe(0);
    const input = JSON.parse(example.stdout); expect(input.schema).toBe("urn:keryx:research-mandate:1");
    const directory = mkdtempSync(join(tmpdir(), "keryx-mandate-cli-")), file = join(directory, "synthetic.json");
    writeFileSync(file, JSON.stringify(mandateExample()));
    const result = run("--input", file); expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ executionAuthorized: false, basis: "caller-supplied-policy-and-books" });
    writeFileSync(file, "synthetic-private-marker".repeat(4000));
    const invalid = run("--input", file); expect(invalid.status).toBe(1);
    expect(invalid.stdout).toBe(""); expect(invalid.stderr).not.toContain("synthetic-private-marker");
  });
  it("speaks actual MCP over stdio and preserves the shared compiler cash assessment", async () => {
    const client = new Client({ name: "synthetic-stdio-client", version: "1" });
    const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", script, "--mcp"], env: cleanEnv, cwd: process.cwd(), stderr: "pipe" });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools).toHaveLength(2);
      const input = mandateExample(), baseline = evaluateMandate(input);
      const response = await client.callTool({ name: "research_mandate_assess", arguments: { input } });
      expect(response.structuredContent).toMatchObject({ executionAuthorized: false, cash: baseline.cash, assessment: baseline.assessment });
    } finally { await client.close(); }
  });
});
