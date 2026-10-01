import { inspectGatewayFundingSqliteOperation } from "../lib/operator/gateway-funding-inspection.ts";
let bytes = 0; const chunks: Buffer[] = [];
try {
  for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 8192) throw new Error(); chunks.push(Buffer.from(chunk)); }
  const wire = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes));
  const report = await inspectGatewayFundingSqliteOperation(JSON.parse(wire));
  const output = JSON.stringify(report); if (Buffer.byteLength(output) > 8192) throw new Error(); process.stdout.write(output);
} catch { process.stderr.write("Funding inspection unavailable; private details omitted\n"); process.exitCode = 1; }
