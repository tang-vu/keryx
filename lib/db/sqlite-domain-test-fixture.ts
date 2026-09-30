import { afterAll, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SqliteAdapter } from "./sqlite-adapter";
import { provisionSyntheticStorage } from "./storage-identity-fixture";
import type { StorageIdentity } from "./storage-identity";
import { DatabaseSync } from "node:sqlite";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { inspectSqliteEnrollment, enrollSqliteStorage } from "./storage-identity-provision";
import { assertStorageFences, assertStorageIdentity, installStorageFences, registerStorageCapability } from "./storage-identity-sqlite";
import type { PaymentRecord } from "../types";

/** Test-only lifecycle. An existing unknown file is never adopted or relabelled. */
export function sqliteDomainTestFixtures() {
  const identities=new Map<string,StorageIdentity>(), adapters=new Set<SqliteAdapter>(), directories:string[]=[];
  const rawConnections=new Set<DatabaseSync>();
  afterAll(()=>{
    for(const db of adapters) db.close();
    for(const db of rawConnections) {try{db.close();}catch{/* caller may already close */}}
    for(const directory of directories) rmSync(directory,{recursive:true,force:true});
    vi.unstubAllEnvs();
  });
  const fixtures = {
    async raw(mode:StorageIdentity["authorityMode"],file?:string) {
      if(!file){const directory=mkdtempSync(join(tmpdir(),"keryx-raw-domain-"));directories.push(directory);file=join(directory,"store.sqlite");}
      if(!identities.has(file)){const identity=await provisionSyntheticStorage(file,mode);identities.set(file,identity);}
      const db=fixtures.trustedRaw(file);
      return {db,identity:fixtures.identity(file),fence:()=>installStorageFences(db,fixtures.identity(file!))};
    },
    async historicalSimulations(file:string,records:PaymentRecord[]) {
      const source=await fixtures.open(undefined,"testnet-offline");await source.init();
      for(const record of records) await source.recordPayment({...record,settled:false,settlementStatus:"simulated"});
      const sourceFile=[...identities].find(([,identity])=>identity.storageId===source.getStorageIdentity().storageId)![0];
      const original=fixtures.trustedRaw(sourceFile,{readOnly:true}), legacy=new DatabaseSync(file);
      try {
        legacy.exec(String(original.prepare("SELECT sql FROM sqlite_schema WHERE name='payment_events'").get()?.sql));
        const rows=original.prepare("SELECT * FROM payment_events").all();
        for(const row of rows){const keys=Object.keys(row);legacy.prepare(`INSERT INTO payment_events(${keys.map(key=>`"${key}"`).join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(key=>row[key]));}
      } finally {original.close();legacy.close();source.close();}
      return await fixtures.enrollLegacy(file,"testnet-real");
    },
    async enrollLegacy(file:string,mode:StorageIdentity["authorityMode"]) {
      const identity=syntheticStorageIdentity(mode), inspection=await inspectSqliteEnrollment(file,identity);
      await enrollSqliteStorage(file,identity,{format:"keryx-reviewed-storage-enrollment-v1",inspection,
        provenanceDocumentDigest:identity.provenanceDigest,unknownClassAttestation:inspection.unknownClasses});
      identities.set(file,identity);return identity;
    },
    trustedRaw(file:string,options:{readOnly?:boolean}={}) {
      const identity=identities.get(file);if(!identity)throw new Error("Unknown synthetic storage identity");
      const db=new DatabaseSync(file,options);rawConnections.add(db);
      assertStorageIdentity(db,identity);assertStorageFences(db,identity);
      registerStorageCapability(db,identity,()=>true);return db;
    },
    async open(file:string|undefined,mode:StorageIdentity["authorityMode"],options:{readOnly?:boolean}={}):Promise<SqliteAdapter> {
      if(file===undefined) {
        const directory=mkdtempSync(join(tmpdir(),"keryx-domain-fixture-")); directories.push(directory); file=join(directory,"store.sqlite");
      }
      let identity=identities.get(file);
      if(!existsSync(file)) {mkdirSync(dirname(file),{recursive:true});identity=await provisionSyntheticStorage(file,mode);identities.set(file,identity);}
      if(!identity||identity.authorityMode!==mode) throw new Error("Unknown or conflicting synthetic storage identity");
      if(mode==="testnet-real") vi.stubEnv("CONTENT_MASTER_KEY","67".repeat(32));
      const db=new SqliteAdapter(file,{...options,expectedIdentity:identity}); adapters.add(db); return db;
    },
    identity(file:string) {
      const identity=identities.get(file); if(!identity) throw new Error("Unknown synthetic storage identity");return identity;
    },
  };
  return fixtures;
}
