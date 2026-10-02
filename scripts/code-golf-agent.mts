/** Retired minimal SDK example. No keys, wallet files or network are accessed. */
const guidance = "Use npm run buyer -- --help for bounded buyer quote, payment and recovery, or npm run mcp for the maintained stdio integration. Existing custody requires owner recovery; never replace a wallet to make a sample run.";
if (process.argv.includes("--help")) {
  console.log("The legacy code-golf SDK payment sample is retired. " + guidance);
} else {
  console.error("Legacy code-golf payment is disabled because unrestricted SDK signing and wallet replacement bypass the maintained authority/recovery boundaries. " + guidance);
  process.exitCode = 1;
}
