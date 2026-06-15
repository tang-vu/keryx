/**
 * arc-update — push a product (or traction) update to arc-canteen non-interactively.
 *
 * `arc-canteen update-{product,traction}` reads a multi-line body from stdin and finishes on a
 * BLANK line. This wrapper feeds the message + a terminating blank line, collapsing any internal
 * blank lines so they don't end the input early, then flushes with `arc-canteen push`.
 *
 * Usage:
 *   npm run arc:update -- "Phase 4 shipped: weighted citation settlement + multi-author splits"
 *   npm run arc:update -- --traction "8 real RSS creators onboarded; $0.42 settled to 6 wallets"
 *   npm run arc:update -- --loom https://loom.com/share/xxx "Demo: agent decides → pays → cites"
 *   echo "long body…" | npm run arc:update            (reads stdin if no message arg given)
 *
 * Integrity: only send a --traction update when the numbers are REAL and settled.
 */

import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
let kind: "product" | "traction" = "product";
let loom = "";
const parts: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--traction") kind = "traction";
  else if (a === "--product") kind = "product";
  else if (a === "--loom" && argv[i + 1]) loom = argv[++i];
  else parts.push(a);
}

let message = parts.join(" ").trim();

// Fall back to stdin when no message argument is supplied (supports piping long bodies).
if (!message && !process.stdin.isTTY) {
  message = await new Promise<string>((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c)).on("end", () => resolve(data.trim()));
  });
}

if (!message) {
  console.error('Provide an update message: npm run arc:update -- "what you shipped"');
  process.exit(1);
}

// Collapse blank lines (a blank line would terminate arc-canteen's prompt early), then append Loom.
message = message.replace(/\n\s*\n+/g, "\n").trim();
if (loom) message += `\n${loom}`;

console.log(`→ arc-canteen update-${kind} (${message.length} chars)…`);

const child = spawn("arc-canteen", [`update-${kind}`], { stdio: ["pipe", "inherit", "inherit"], shell: true });
child.stdin.write(message + "\n\n");
child.stdin.end();

child.on("error", (e) => {
  console.error("Failed to run arc-canteen:", e.message);
  process.exit(1);
});
child.on("exit", (code) => {
  // Flush any queued events to the server (no-op if already submitted).
  const push = spawn("arc-canteen", ["push"], { stdio: "inherit", shell: true });
  push.on("exit", () => process.exit(code ?? 0));
  push.on("error", () => process.exit(code ?? 0));
});
