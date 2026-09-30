import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { syntheticStorageIdentity } from "../lib/db/storage-identity-fixture";
import { storageIdentityDigest, StorageIdentityRefused } from "../lib/db/storage-identity";
import { backupVerifiedSqliteStorage, enrollSqliteStorage, inspectSqliteEnrollment } from "../lib/db/storage-identity-provision";
import { canonicalJson } from "../lib/canonical-json";
import { createLegacyRehearsalStore, rehearsalCodeDigest, rehearsalRows } from "./storage-rollout-rehearsal-fixture";

type ChildEvent = { event: string; committed?: boolean; connectionClosed?: boolean; readOnly?: boolean; signingPaused?: boolean };
function child(request: object, drain: boolean) {
  const require = createRequire(import.meta.url);
  const proc = spawn(process.execPath, ["--max-old-space-size=128","--import",pathToFileURL(require.resolve("tsx")).href,
    fileURLToPath(new URL("./storage-rollout-rehearsal-child.mts",import.meta.url))], {
    windowsHide:true,stdio:["pipe","pipe","ignore"],env:process.platform === "win32"
      ? { SystemRoot:process.env.SystemRoot ?? "C:\\Windows",NODE_ENV:"production" } : { NODE_ENV:"production" },
  });
  return new Promise<{ events:ChildEvent[]; exitCode:number|null; deadline:boolean }>((resolve,reject) => {
    let buffer = "", bytes = 0, deadline = false; const events:ChildEvent[] = [];
    const timer = setTimeout(() => { deadline = true; proc.kill("SIGKILL"); },10000);
    proc.stdout.on("data",(chunk:Buffer) => {
      bytes += chunk.length; if(bytes > 4096) { proc.kill("SIGKILL"); return; }
      buffer += chunk.toString("utf8");
      let boundary:number;
      while ((boundary=buffer.indexOf("\n")) >= 0) {
        const line=buffer.slice(0,boundary); buffer=buffer.slice(boundary+1);
        try {
          const event:ChildEvent=JSON.parse(line); events.push(event);
          if(event.event === "writer-ready" && drain) proc.stdin.end(JSON.stringify({action:"drain"})+"\n");
        } catch { proc.kill("SIGKILL"); }
      }
    });
    proc.once("error",()=>{clearTimeout(timer);reject(new Error("Rehearsal child unavailable"));});
    proc.once("close",exitCode=>{clearTimeout(timer);resolve({events,exitCode,deadline});});
    proc.stdin.on("error",()=>{/* exit determines admission */});
    proc.stdin.write(JSON.stringify(request)+"\n");
    if (!drain && (request as {operation?:string}).operation !== "legacy-writer") proc.stdin.end();
  });
}
function assert(value:unknown):asserts value { if(!value) throw new Error("Rehearsal evidence incomplete"); }
const equal = (left:unknown,right:unknown) => JSON.stringify(left) === JSON.stringify(right);
const digest = (value:Buffer) => createHash("sha256").update(value).digest("hex");
function markerDigest(file:string):string|null {
  const db=new DatabaseSync(file,{readOnly:true,allowExtension:false});
  try {
    if(!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='keryx_storage_identity'").get()) return null;
    const value=db.prepare("SELECT identity FROM keryx_storage_identity WHERE id=1").get()?.identity;
    return typeof value === "string" ? digest(Buffer.from(value)) : "invalid_marker";
  } finally { db.close(); }
}

/** Creates and removes its own synthetic directory; never accepts a store/path/identity from an operator. */
export async function storageRolloutRehearsal(options:{ injectFailure?:"identity-mismatch"|"old-writer-undrained" }={}) {
  const started=Date.now(), directory=mkdtempSync(join(tmpdir(),"keryx-storage-rollout-"));
  const signingPaused=true, admissionClosed=true;
  let stage="fixture";
  const file=join(directory,"legacy.sqlite");
  let original:ReturnType<typeof rehearsalRows>|undefined, originalMarker:string|null=null;
  try {
    const manifest=join(directory,"manifest.json"), gate=join(directory,"gate.json");
    writeFileSync(join(directory,"rehearsal-only.json"),'{"syntheticStorageRolloutFixture":true}',{mode:0o600});
    createLegacyRehearsalStore(file);
    original=rehearsalRows(file);
    stage="writer_drain";
    const writer = await child({operation:"legacy-writer",file},options.injectFailure !== "old-writer-undrained");
    const oldWriterExitAcknowledged = writer.exitCode === 0 && !writer.deadline
      && writer.events.some(event=>event.event === "drained" && event.committed === true && event.connectionClosed === true);
    assert(oldWriterExitAcknowledged);
    original=rehearsalRows(file);const expected=syntheticStorageIdentity("testnet-real");
    assert(original.metadataCounter === 2);
    stage="legacy_inspection";
    const inspection=await inspectSqliteEnrollment(file,expected);
    assert(!inspection.enrollmentRefusal && inspection.unknownClasses.includes("historical_simulated_payment_origin"));
    stage="legacy_enrollment";
    await enrollSqliteStorage(file,expected,{format:"keryx-reviewed-storage-enrollment-v1",inspection,
      provenanceDocumentDigest:expected.provenanceDigest,unknownClassAttestation:inspection.unknownClasses});
    assert(equal(rehearsalRows(file),original));
    originalMarker=markerDigest(file);
    writeFileSync(manifest,canonicalJson({format:"keryx-storage-deployment-v1",identity:expected,backend:{kind:"sqlite",databasePath:file}}),{mode:0o600});
    writeFileSync(gate,JSON.stringify({signingPaused,admissionClosed,oldWriterExitAcknowledged}),{mode:0o600});
    const snapshot=join(directory,"snapshot.sqlite");
    stage="snapshot";
    const backup=await backupVerifiedSqliteStorage(file,expected,snapshot);
    assert(backup.signingResumeAuthorized === false && equal(rehearsalRows(snapshot),original));
    const admittedIdentity=options.injectFailure === "identity-mismatch" ? syntheticStorageIdentity("testnet-real") : expected;
    const codeDigest=rehearsalCodeDigest();
    const candidateRequest={operation:"candidate-readonly",manifest,gate,codeDigest,expectedIdentityDigest:storageIdentityDigest(admittedIdentity)};
    stage="readonly_startup";
    const startup=await child(candidateRequest,false);
    assert(startup.exitCode === 0 && startup.events.some(event=>event.event === "candidate-admitted" && event.readOnly && event.signingPaused));
    assert(equal(rehearsalRows(file),original));
    const restart=await child(candidateRequest,false);
    assert(restart.exitCode === 0 && restart.events.some(event=>event.event === "candidate-admitted"));
    assert(codeDigest === rehearsalCodeDigest());
    assert(equal(rehearsalRows(file),original));
    stage="negative_writer";
    const unfenced=await child({operation:"unfenced-writer",file},false);
    assert(unfenced.exitCode !== 0 && unfenced.events.some(event=>event.event === "refused"));
    assert(equal(rehearsalRows(file),original));
    const foreign=await child({...candidateRequest,expectedIdentityDigest:storageIdentityDigest(syntheticStorageIdentity("testnet-real"))},false);
    assert(foreign.exitCode !== 0 && foreign.events.some(event=>event.event === "refused"));
    assert(equal(rehearsalRows(file),original));
    // Separate ineligible lane: positive cap, original nonce and active journal
    // must remain unchanged on refusal, never become eligible through attestation.
    stage="ineligible_refusal";
    const ineligible=join(directory,"ineligible.sqlite");createLegacyRehearsalStore(ineligible,true);
    const deniedOriginal=rehearsalRows(ineligible), deniedBytes=digest(readFileSync(ineligible));
    const deniedInspection=await inspectSqliteEnrollment(ineligible,expected);
    assert(deniedInspection.enrollmentRefusal === "unresolved_funded_or_authority_provenance");
    let refused=false;
    try { await enrollSqliteStorage(ineligible,expected,{format:"keryx-reviewed-storage-enrollment-v1",inspection:deniedInspection,
      provenanceDocumentDigest:expected.provenanceDigest,unknownClassAttestation:deniedInspection.unknownClasses}); }
    catch { refused=true; }
    assert(refused && equal(rehearsalRows(ineligible),deniedOriginal) && digest(readFileSync(ineligible)) === deniedBytes);
    return {format:"keryx-storage-rollout-rehearsal-v1",status:"passed",synthetic:true,signingPaused,admissionClosed,
      productionAdmissionOpen:false,signingResumeAuthorized:false,oldWriterExitAcknowledged,legacyEnrollment:"eligible_metadata_and_simulation_only",
      oldWriterCommittedIncrement:true,
      statePreserved:true,snapshotVerified:true,wrongIdentityRefused:true,unfencedWriterRefused:true,
      ineligibleAuthorityRefused:true,ineligibleMainFileBytesPreserved:true,
      ineligibleAggregate:{grantRows:deniedOriginal.grantRows,nonceRows:deniedOriginal.nonceRows,journalActive:deniedOriginal.journalActive},
      enrolledAggregate:{rows:original.rows,grantRows:original.grantRows,nonceRows:original.nonceRows,journalActive:original.journalActive},
      rollbackScope:"same-pinned-code-readonly-process-restart",candidateBaseline:"0c52b0fac59f640cfe7fc5c04a7a5dcde2fa8c5d",
      selectedCodeDigest:codeDigest,
      durationMs:Date.now()-started};
  } catch(error) {
    let failureStatePreserved=false,identityMarkerUnchanged=false;
    try {
      if(original && existsSync(file)) {
        failureStatePreserved=equal(rehearsalRows(file),original);
        identityMarkerUnchanged=markerDigest(file) === originalMarker;
      }
    } catch { /* incomplete evidence never becomes success */ }
    return {format:"keryx-storage-rollout-rehearsal-v1",status:"refused",synthetic:true,signingPaused,admissionClosed,
      productionAdmissionOpen:false,signingResumeAuthorized:false,stage,
      failureStatePreserved,identityMarkerUnchanged,
      reason:error instanceof StorageIdentityRefused ? error.reason : "evidence_incomplete",durationMs:Date.now()-started};
  } finally { rmSync(directory,{recursive:true,force:true}); }
}
