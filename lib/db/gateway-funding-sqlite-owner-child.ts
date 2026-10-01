import { inspectGatewayFundingSqliteOwnerTarget, installGatewayFundingSqliteOwnerAuthorization,
  installGatewayFundingSqliteOwnerPolicy } from "./gateway-funding-sqlite-native";
import { fundingRecord } from "./gateway-funding-ledger-validation";
import { validateStorageIdentity } from "./storage-identity";

let request = "";
process.stdin.on("data", (bytes: Buffer) => { if (Buffer.byteLength(request) + bytes.length > 65536) process.exit(1); request += bytes.toString("utf8"); });
process.stdin.on("end", () => {
  try {
    const r = fundingRecord(JSON.parse(request), ["mode", "file", "identity", "input"]);
    if (typeof r.file !== "string") throw new Error();
    const identity = validateStorageIdentity(r.identity);
    const result = r.mode === "inspect" ? inspectGatewayFundingSqliteOwnerTarget(r.file, identity)
      : r.mode === "policy" ? installGatewayFundingSqliteOwnerPolicy(r.file, identity, r.input)
      : r.mode === "authorization" ? installGatewayFundingSqliteOwnerAuthorization(r.file, identity, r.input)
      : null;
    if (!result) throw new Error(); process.stdout.write(JSON.stringify(result));
  } catch { process.stdout.write('{"refused":true}'); }
});
