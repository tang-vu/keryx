import fs from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../../lib/canonical-json";
import { getSqliteRegistrationSponsor } from "../../lib/db/registration-sponsor";

export const FUNDED_BASELINE = Object.freeze({
  reportSha256: "4a53fa1953f3207eb360271c3c0a9023386fea59b0e25bd60175c00c8feb9365",
  nativeFingerprintSha256: "f7db56a58a67d257221d5e947896388ec522befd9c37a2c81954e01b8e2b9814",
  sourceCommit: "51708d76e39a11622cf58729a2bfac0bfc24e2b6",
  sourceDigest: "0eb86f972b4ea1704c4cfd54e07a00a5b721d5ba1d1a6301b7497fa39d24120a",
  policyDigest: "0xc03dab66b51407aac227af9f14171c815cd0f340449c96297328a7fd9cad56dd",
  runId: "f488f08c-3c17-4e08-9d8d-bcda3d4da2bf", actualGasWei: "24540160001227008",
  expiredOriginalId: "0xa2a3df62572210b0f3e19a8a9574397ed4c5ef2824fe1a8d0fd3d5ccbb8acf7f",
  creator: "0xc5965e3175ef063faeb8bcd3abe2d25b5d27d586", aggregateCapWei: "160000000000000000",
});
export interface FundedBaselineBinding { directory: string; reportSha256: string; nativeFingerprintSha256: string; actualGasWei: string; }
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function refuse(): never { throw new Error("Closed testnet baseline or aggregate allowance changed"); }

export function assertSupplementAggregate(baseline: { confirmed: number; expired: number; uncertain: number; actualGasWei: string }, supplementalMaximumWei: string) {
  if (baseline.confirmed !== 4 || baseline.expired !== 1 || baseline.uncertain !== 0 || baseline.actualGasWei !== FUNDED_BASELINE.actualGasWei ||
    supplementalMaximumWei !== "40000000000000000" || BigInt(baseline.actualGasWei) + BigInt(supplementalMaximumWei) > BigInt(FUNDED_BASELINE.aggregateCapWei)) refuse();
  return { baselineActualGasWei: baseline.actualGasWei, supplementalMaximumWei,
    combinedMaximumWei: (BigInt(baseline.actualGasWei) + BigInt(supplementalMaximumWei)).toString(), aggregateCapWei: FUNDED_BASELINE.aggregateCapWei };
}

/** Read-only baseline snapshot. Neither the first policy nor its attempt/receipt books can change. */
export function inspectFundedBaseline(directory: string, assertPrivate: (path: string, directory: boolean) => unknown): FundedBaselineBinding {
  assertPrivate(directory, true);
  const reportPath = join(directory, "frozen-five-attempt-report-51708.json"), databasePath = join(directory, "funded-registration.sqlite");
  assertPrivate(reportPath, false); assertPrivate(databasePath, false);
  const bytes = fs.readFileSync(reportPath);
  if (sha256(bytes) !== FUNDED_BASELINE.reportSha256) refuse();
  const report = JSON.parse(bytes.toString("utf8"));
  if (report.network !== "eip155:5042002" || report.sourcePin.declaredCommit !== FUNDED_BASELINE.sourceCommit ||
    report.sourcePin.exactSourceDigest !== FUNDED_BASELINE.sourceDigest || report.policyDigest !== FUNDED_BASELINE.policyDigest || report.admitted !== 5) refuse();
  const native = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const retained = readFundedBaselineNative(native);
    if (retained.nativeFingerprintSha256 !== FUNDED_BASELINE.nativeFingerprintSha256) refuse();
    return { directory, reportSha256: FUNDED_BASELINE.reportSha256, ...retained };
  }
  finally { native.close(); }
}

/** Validate one immutable snapshot using the core reader without nesting its read transaction. */
export function readFundedBaselineNative(native: DatabaseSync) {
  const validation = new DatabaseSync(":memory:");
  try {
    native.exec("BEGIN");
    const tables = ["fixture_manifest", "fixture_lock", "fixture_events", "fixture_index", "sync_state"];
    for (const table of tables) if (Number(native.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count) > 512) refuse();
    const snapshot = Object.fromEntries(tables.map(table => [table, native.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]));
    if (snapshot.fixture_lock.length) refuse();
    const envelope = JSON.parse(String(native.prepare("SELECT value FROM fixture_manifest WHERE singleton=1").get()?.value));
    const configuration = envelope.configuration;
    if (configuration.format !== "keryx-registration-sponsor-funded-acceptance-v1" || configuration.runId !== FUNDED_BASELINE.runId ||
      configuration.sourceCommit !== FUNDED_BASELINE.sourceCommit || configuration.policy.maxRegistrationsTotal !== 5 ||
      configuration.policy.maxLifetimeWei !== FUNDED_BASELINE.aggregateCapWei || envelope.sourceBinding.digest !== FUNDED_BASELINE.sourceDigest) refuse();
    const rows = native.prepare("SELECT value FROM sync_state WHERE key LIKE 'keryx:registration-sponsor:v1:row:%' ORDER BY key").all();
    if (rows.length !== 5) refuse();
    // Core recovery validates policy bindings, originals, lineage and private execution
    // hashes. Its BEGIN/COMMIT runs only in this private bounded memory copy.
    validation.exec("CREATE TABLE sync_state(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT");
    const insert = validation.prepare("INSERT INTO sync_state VALUES(?,?,?)");
    for (const saved of snapshot.sync_state) insert.run(saved.key, saved.value, saved.updated_at);
    let confirmed = 0, expired = 0, uncertain = 0, actual = BigInt(0);
    for (const saved of rows) {
      const raw = JSON.parse(String(saved.value)).current;
      const row = getSqliteRegistrationSponsor(validation, { wallet: FUNDED_BASELINE.creator, id: raw.id });
      if (!row || row.policyDigest !== FUNDED_BASELINE.policyDigest) refuse();
      if (row.state === "confirmed") { confirmed++; actual += BigInt(row.actualGasWei!); }
      else if (row.state === "expired" && row.id === FUNDED_BASELINE.expiredOriginalId && row.transactionNonce === undefined &&
        row.transactionHash === undefined && row.actualGasWei === undefined) expired++;
      else uncertain++;
    }
    assertSupplementAggregate({ confirmed, expired, uncertain, actualGasWei: actual.toString() }, "40000000000000000");
    const nativeFingerprintSha256 = sha256(canonicalJson(snapshot)); native.exec("COMMIT");
    return { nativeFingerprintSha256, actualGasWei: actual.toString() };
  } catch (error) { try { native.exec("ROLLBACK"); } catch { /* Preserve the initial refusal. */ } throw error; }
  finally { validation.close(); }
}

export function verifyFundedBaseline(retained: FundedBaselineBinding, assertPrivate: (path: string, directory: boolean) => unknown) {
  const fresh = inspectFundedBaseline(retained.directory, assertPrivate);
  if (canonicalJson(fresh) !== canonicalJson(retained)) refuse();
  return assertSupplementAggregate({ confirmed: 4, expired: 1, uncertain: 0, actualGasWei: fresh.actualGasWei }, "40000000000000000");
}
