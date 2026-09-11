import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createWithdrawalMintJournal } from "../../lib/gateway/withdrawal-mint-journal";

// Synthetic test payload on stdin only. This child has no signing or network path.
const input = JSON.parse(readFileSync(0, "utf8"));
const db = new DatabaseSync(process.argv[2]);
try {
  const journal = createWithdrawalMintJournal(db, input.policy);
  try {
    await journal.reserve(input.record, input.response, input.terms);
    if (input.raw) await journal.savePrepared(input.record.id, input.raw);
    process.stdout.write("saved");
  } catch (error) {
    if (error instanceof Error && error.message === "Mint nonce unavailable") process.stdout.write("nonce-denied");
    else throw error;
  }
} finally { db.close(); }
