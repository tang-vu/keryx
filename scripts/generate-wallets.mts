/** Retired legacy provisioner. Help and refusal require no custody or key access. */
const guidance = "Preserve existing environment files, wallets and owner backups. Provision testnet secrets privately through the owner-managed environment: AGENT_FUNDER_PRIVATE_KEY for server funding, or KERYX_BUYER_PRIVATE_KEY for the caller-owned buyer/stdio role and its trusted merchant policy. Persistent treasury custody needs its separate owner procedure. See docs/treasury-wallet-custody.md and docs/buyer-agent.md. Offline development needs no wallet keys.";

if (process.argv.includes("--help")) {
  console.log("The legacy wallet generator is retired. " + guidance);
} else {
  console.error("Legacy wallet generation is disabled: it exposed private keys and replaced existing environment custody under obsolete buyer labels. " + guidance);
  process.exitCode = 1;
}
