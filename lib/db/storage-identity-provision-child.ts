import { provisionStorageInChild, type StorageProvisionRequest } from "./storage-identity-provision-core";
import { StorageIdentityRefused } from "./storage-identity";
async function main() {
let bytes = 0, request = "";
try {
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 128 * 1024) throw new StorageIdentityRefused("request_limit");
    request += chunk.toString("utf8");
  }
  const result = provisionStorageInChild(JSON.parse(request) as StorageProvisionRequest);
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stdout.write(JSON.stringify({ refusal: error instanceof StorageIdentityRefused ? error.reason : "operation_unavailable" }));
}

}
void main();
