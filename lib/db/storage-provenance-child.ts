import { scanStorageProvenance } from "./storage-provenance-scan";
import type { ProvenanceLimits } from "./storage-provenance";

// Internal child only: explicit arguments, no environment files/config/adapters/network/signing.
try {
  const limits = JSON.parse(process.argv[3]) as ProvenanceLimits;
  console.log(JSON.stringify(scanStorageProvenance(process.argv[2], limits)));
} catch { process.exitCode = 1; }
