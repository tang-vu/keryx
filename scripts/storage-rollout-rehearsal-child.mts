import { createInterface } from "node:readline";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { inspectStorageDeploymentManifest } from "../lib/db/runtime-storage-config";
import { openVerifiedSqliteStorage } from "../lib/db/storage-identity-connection";
import { storageIdentityDigest } from "../lib/db/storage-identity";
import { rehearsalCodeDigest } from "./storage-rollout-rehearsal-fixture";

globalThis.fetch = async () => { throw new Error("Rehearsal networking disabled"); };
const emit = (value: object) => process.stdout.write(JSON.stringify(value) + "\n");
const input = createInterface({ input: process.stdin });
let writer: DatabaseSync | undefined, started = false;
input.on("line", line => {
  try {
    if (Buffer.byteLength(line) > 8192) throw new Error();
    const request = JSON.parse(line);
    if (started) {
      if (request.action !== "drain" || !writer) throw new Error();
      writer.exec("COMMIT"); writer.close(); writer = undefined;
      emit({ event: "drained", committed: true, connectionClosed: true }); input.close(); process.stdin.destroy(); return;
    }
    started = true;
    // Internal child only admits files in a fresh, explicitly synthetic fixture
    // directory. The public CLI accepts no target argument.
    const target=request.file ?? request.manifest;
    if(typeof target !== "string") throw new Error();
    const directory=dirname(target);
    if(realpathSync(directory) !== directory || !/^keryx-storage-rollout-[a-zA-Z0-9]+$/.test(basename(directory))) throw new Error();
    const marker=join(directory,"rehearsal-only.json");
    if(!lstatSync(marker).isFile() || lstatSync(marker).isSymbolicLink() || lstatSync(marker).size > 128
      || readFileSync(marker,"utf8") !== '{"syntheticStorageRolloutFixture":true}') throw new Error();
    const checked=(file:string,name:string) => {
      if(file !== join(directory,name) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error();
    };
    if(request.file) checked(request.file,"legacy.sqlite");
    if (request.operation === "legacy-writer") {
      writer = new DatabaseSync(request.file, { allowExtension: false });
      writer.exec("BEGIN IMMEDIATE; UPDATE rate_limit_counters SET count=count+1 WHERE bucket='synthetic'");
      emit({ event: "writer-ready", transactionOpen: true }); return;
    }
    if (request.operation === "unfenced-writer") {
      const db = new DatabaseSync(request.file, { allowExtension: false });
      try { db.exec("UPDATE rate_limit_counters SET count=count+1"); throw new Error("Unexpected unfenced write"); }
      finally { db.close(); }
    } else if (request.operation === "candidate-readonly") {
      if(request.codeDigest !== rehearsalCodeDigest()) throw new Error();
      checked(request.manifest,"manifest.json");checked(request.gate,"gate.json");
      if(lstatSync(request.gate).size > 512) throw new Error();
      const gate = JSON.parse(readFileSync(request.gate, "utf8"));
      if (gate.admissionClosed !== true || gate.signingPaused !== true || gate.oldWriterExitAcknowledged !== true) throw new Error();
      const deployment = inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: request.manifest });
      if (deployment.backend.kind !== "sqlite" || storageIdentityDigest(deployment.identity) !== request.expectedIdentityDigest) throw new Error();
      checked(deployment.backend.databasePath,"legacy.sqlite");
      const held = openVerifiedSqliteStorage(deployment.backend.databasePath, deployment.identity, { readOnly: true });
      try {
        held.db.prepare("SELECT count(*) n FROM payment_events").get();
        emit({ event: "candidate-admitted", readOnly: true, signingPaused: true });
      } finally { held.close(); }
    } else throw new Error();
    input.close(); process.stdin.destroy();
  } catch {
    try { writer?.close(); } catch { /* rollback/close remains best effort */ }
    emit({ event: "refused", admissionClosed: true, signingPaused: true });
    process.exitCode = 1; input.close(); process.stdin.destroy();
  }
});
