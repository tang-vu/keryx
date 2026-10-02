import { scanStorageProvenance } from "./storage-provenance-scan";
import { validatedProvenanceLimits } from "./storage-provenance";

// Internal child only: explicit arguments, no environment files/config/adapters/network/signing.
try {
  const mode = process.argv[4];
  const input: unknown = JSON.parse(process.argv[3]);
  const limits = validatedProvenanceLimits(input, mode);
  if (!limits || (mode !== "standard" && mode !== "offline_snapshot") ||
    process.argv.length !== (mode === "offline_snapshot" ? 6 : 5)) throw new Error();
  console.log(JSON.stringify(scanStorageProvenance(process.argv[2], limits, mode, process.argv[5])));
} catch { process.exitCode = 1; }
