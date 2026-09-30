import { expect,it } from "vitest";
import { storageRolloutRehearsal } from "./storage-rollout-rehearsal-core";

it("drains the actual old child, enrolls only eligible legacy state and restarts the same readonly candidate",async()=>{
  const report=await storageRolloutRehearsal();
  expect(report).toMatchObject({status:"passed",oldWriterExitAcknowledged:true,signingPaused:true,admissionClosed:true,
    productionAdmissionOpen:false,signingResumeAuthorized:false,statePreserved:true,snapshotVerified:true,
    wrongIdentityRefused:true,unfencedWriterRefused:true,ineligibleAuthorityRefused:true,ineligibleMainFileBytesPreserved:true,
    enrolledAggregate:{rows:3,grantRows:0,nonceRows:0,journalActive:false},
    ineligibleAggregate:{grantRows:1,nonceRows:1,journalActive:true},rollbackScope:"same-pinned-code-readonly-process-restart"});
  expect(JSON.stringify(report)).not.toMatch(/\.sqlite|manifest\.json|original-synthetic-epoch|syntheticStorageRolloutFixture|privateKey|0x1111/);
  expect(report.durationMs).toBeGreaterThan(0);
},20000);

it("never adopts a new UUID or opens admission after wrong-identity startup",async()=>{
  const report=await storageRolloutRehearsal({injectFailure:"identity-mismatch"});
  expect(report).toMatchObject({status:"refused",stage:"readonly_startup",signingPaused:true,admissionClosed:true,
    productionAdmissionOpen:false,signingResumeAuthorized:false,failureStatePreserved:true,identityMarkerUnchanged:true});
},20000);

it("refuses enrollment when the old writer has not acknowledged drain and exited",async()=>{
  const report=await storageRolloutRehearsal({injectFailure:"old-writer-undrained"});
  expect(report).toMatchObject({status:"refused",stage:"writer_drain",signingPaused:true,admissionClosed:true,
    productionAdmissionOpen:false,signingResumeAuthorized:false,failureStatePreserved:true,identityMarkerUnchanged:true});
},20000);
