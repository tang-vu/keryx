import { closeSync, constants, fstatSync, openSync } from "node:fs";
import { backup, DatabaseSync } from "node:sqlite";
import { refuseStorage, storageIdentityDigest, validateStorageIdentity, type StorageIdentity } from "./storage-identity";
import { assertStorageCreationParent, assertStorageFences, assertStorageIdentity, holdStorageTarget } from "./storage-identity-sqlite";
import { scanFullStorageSnapshot, STORAGE_SNAPSHOT_LIMITS } from "./storage-identity-snapshot";
import type { StorageBackupReceipt } from "./storage-identity-provision";

/** Child-only readonly native snapshot. Failures retain uncertain output; never overwrite or relabel it. */
export async function backupStorageInChild(request: { file: string; identity: StorageIdentity; freshOutput: string }): Promise<StorageBackupReceipt> {
  const identity=validateStorageIdentity(request.identity), sourceHeld=holdStorageTarget(request.file);
  let source: DatabaseSync | undefined, copied: DatabaseSync | undefined;
  let outputDescriptor: number | undefined, outputHeld: ReturnType<typeof holdStorageTarget> | undefined;
  try {
    if(fstatSync(sourceHeld.descriptor).size>STORAGE_SNAPSHOT_LIMITS.fileBytes) refuseStorage("file_limit");
    source=new DatabaseSync(request.file,{readOnly:true,allowExtension:false});
    sourceHeld.verify(); assertStorageIdentity(source,identity); assertStorageFences(source,identity);
    source.exec("BEGIN");
    const before=scanFullStorageSnapshot(source);
    // Keep this source read transaction through sqlite3_backup: copy the same consistent snapshot.
    assertStorageCreationParent(request.freshOutput);
    outputDescriptor=openSync(request.freshOutput,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|(constants.O_NOFOLLOW??0),0o600);
    outputHeld=holdStorageTarget(request.freshOutput);
    const original=fstatSync(outputDescriptor,{bigint:true}), admitted=fstatSync(outputHeld.descriptor,{bigint:true});
    if(original.dev!==admitted.dev||original.ino!==admitted.ino||original.birthtimeNs!==admitted.birthtimeNs) refuseStorage("target_replaced");
    await backup(source,request.freshOutput,{rate:100,progress:()=>{
      sourceHeld.verify(); outputHeld!.verify();
      if(fstatSync(outputDescriptor!).size>STORAGE_SNAPSHOT_LIMITS.fileBytes) refuseStorage("file_limit");
    }});
    outputHeld.verify(); sourceHeld.verify();
    if(fstatSync(outputDescriptor).size>STORAGE_SNAPSHOT_LIMITS.fileBytes) refuseStorage("file_limit");
    copied=new DatabaseSync(request.freshOutput,{readOnly:true,allowExtension:false});
    copied.exec("BEGIN");
    assertStorageIdentity(copied,identity); assertStorageFences(copied,identity);
    if(copied.prepare("PRAGMA integrity_check(1)").get()?.integrity_check!=="ok") refuseStorage("integrity_failed");
    const after=scanFullStorageSnapshot(copied);
    if(before.schemaDigest!==after.schemaDigest||before.snapshotDigest!==after.snapshotDigest) refuseStorage("snapshot_changed");
    sourceHeld.verify(); outputHeld.verify();
    return {format:"keryx-storage-backup-receipt-v1",identityDigest:storageIdentityDigest(identity),sourceTargetDigest:sourceHeld.identity,outputTargetDigest:outputHeld.identity,
      schemaDigest:after.schemaDigest,snapshotDigest:after.snapshotDigest,signingResumeAuthorized:false};
  } finally {
    try { copied?.close(); } finally {
      try { source?.close(); } finally {
        try { outputHeld?.close(); } finally { try {if(outputDescriptor!==undefined) closeSync(outputDescriptor);} finally {sourceHeld.close();} }
      }
    }
  }
}
