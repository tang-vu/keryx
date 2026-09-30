import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { probeArcMainnet } from "../lib/readiness/arc-mainnet-probe.ts";

// Read package metadata and bundled text; do not import SDK clients or signers.
async function sdkEvidence() {
  try {
    const root = new URL("../node_modules/@circle-fin/x402-batching/", import.meta.url);
    const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
    const client = await readFile(new URL("dist/client/index.mjs", root), "utf8");
    const server = await readFile(new URL("dist/server/index.mjs", root), "utf8");
    const declaration = await readFile(new URL("dist/client/index.d.ts", root), "utf8");
    const arcBlock = /\n  arc: \{([\s\S]*?)\n  \}/;
    const configMatches = (source: string) => {
      const config = source.match(arcBlock)?.[1] ?? "";
      return /chain: arcMainnet/.test(config) && /domain: GATEWAY_DOMAINS.arc[,\s]/.test(config) &&
        /usdc: "0x3600000000000000000000000000000000000000"/.test(config) &&
        /gatewayWallet: MAINNET_GATEWAY_WALLET/.test(config) && /gatewayMinter: MAINNET_GATEWAY_MINTER/.test(config) &&
        /id: 5042,/.test(source) && /arc: 26/.test(source) &&
        /MAINNET_GATEWAY_WALLET = "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE"/.test(source) &&
        /MAINNET_GATEWAY_MINTER = "0x2222222d7164433c4C09B0b0D809a9b52C04C205"/.test(source);
    };
    return { package: "@circle-fin/x402-batching", version: packageJson.version,
      inspection: "static_bundled_metadata_only", mainnetArcMetadataMatches: packageJson.version === "3.5.0" &&
        configMatches(client) && configMatches(server) && /readonly arc: 26/.test(declaration),
      artifacts: [{ path: "dist/client/index.mjs", sha256: createHash("sha256").update(client).digest("hex") },
        { path: "dist/server/index.mjs", sha256: createHash("sha256").update(server).digest("hex") }],
      settlementAccepted: false };
  } catch { return { inspection: "unavailable", settlementAccepted: false }; }
}

export async function inspectArcMainnet() {
  return { ...await probeArcMainnet(), sdk: await sdkEvidence() };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.length > 2) {
    console.error("No arguments accepted; public read-only endpoints are fixed.");
    process.exitCode = 2;
  } else {
    const evidence = await inspectArcMainnet();
    console.log(JSON.stringify(evidence, null, 2));
    process.exitCode = evidence.externalEvidenceComplete ? 0 : 1;
  }
}
