/** Retired sponsored demo. Deliberately imports no configuration, wallet or network code. */
const message = `The legacy treasury-funded A2A demo is retired.
Use npm run buyer -- --help for caller-funded quote/buy/resume commands with a pinned
payee, an explicit total limit and a durable private job directory.
No wallet was created, read, replaced or funded; no payment was signed or submitted.
Keep legacy wallet files and unresolved payment records for operator reconciliation.
Do not buy again to recover an old payment. Legacy wallets are not buyer job journals.
Scheduled demo callers must not automatically migrate to the buyer command.`;

if (process.argv.length === 3 && process.argv[2] === "--help") {
  console.log(message);
} else {
  console.error(message);
  process.exitCode = 1;
}
