/** Legacy address-only keystore inspection. Live SDK withdrawal is retired. */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const guidance = "Use the creator withdrawal workflow in docs/creator-withdrawal-recovery.md, then npm run withdrawal:relay and npm run withdrawal:report with the original journal. These tools do not automatically replace legacy signatures or journals.";
  if (argv.includes("--help")) {
    console.log("Usage: npm run withdraw -- [--label <id>] [--random <count>] [--min <USDC>]\nAddress-only legacy keystore balance inspection; no funds moved.\n--live is retired. " + guidance);
    return;
  }
  // Refuse before importing configuration, inspecting the keystore or contacting
  // Circle/RPC. The npm entry does not implicitly load an environment file.
  if (argv.includes("--live")) {
    console.error("Legacy live withdrawal is disabled because SDK-controlled mint signing does not preserve the guarded durable withdrawal workflow. " + guidance);
    process.exitCode = 1;
    return;
  }
  let label: string | undefined;
  let random: number | undefined;
  let min = 0.02;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--label") label = argv[++i];
    else if (arg === "--random") random = Number(argv[++i]);
    else if (arg === "--min") min = Number(argv[++i]);
    else if (arg !== "--all") throw new Error(`Unsupported inspection option: ${arg}. Use --help.`);
  }
  if (!Number.isFinite(min) || min < 0 || (random !== undefined && (!Number.isSafeInteger(random) || random < 1))) {
    throw new Error("Inspection limits must be finite nonnegative USDC and a positive integer wallet count");
  }
  const fs = await import("node:fs");
  const path = await import("node:path");
  const file = path.resolve(process.cwd(), "data", "wallets.json");
  let store: Record<string, { address?: unknown }>;
  try { store = JSON.parse(fs.readFileSync(file, "utf8")) as typeof store; }
  catch { throw new Error("No readable local creator keystore; no balances inspected"); }
  if (!store || typeof store !== "object" || Array.isArray(store)) throw new Error("Invalid local keystore");
  let entries = Object.entries(store).filter(([id]) => label === undefined || id === label);
  if (random !== undefined) entries = [...entries].sort(() => Math.random() - 0.5).slice(0, random);
  if (!entries.length) throw new Error("No matching keystore entries (check --label)");
  const { config } = await import("../lib/config.ts");
  const { getGatewayAvailableAtomic } = await import("../lib/gateway/gateway-balance.ts");
  console.log(`DRY-RUN · chain=${config.network} · ${entries.length} wallet(s) · min=$${min}`);
  for (const [id, wallet] of entries) {
    if (!wallet || typeof wallet.address !== "string" || !/^0x[a-f0-9]{40}$/i.test(wallet.address)) {
      console.log(`${id}: invalid address; skipped`);
      continue;
    }
    const available = await getGatewayAvailableAtomic(wallet.address);
    console.log(`${id}\n  ${wallet.address}  available=${available === null ? "unknown" : `$${(Number(available) / 1e6).toFixed(6)}`}`);
  }
  console.log("Dry-run only — no funds moved. " + guidance);
}
await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Legacy balance inspection failed");
  process.exitCode = 1;
});
