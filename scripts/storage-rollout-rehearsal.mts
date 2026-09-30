import { storageRolloutRehearsal } from "./storage-rollout-rehearsal-core";
if(process.argv.length !== 2) {
  console.log(JSON.stringify({status:"refused",admissionClosed:true,signingPaused:true}));process.exitCode=1;
} else {
  const report=await storageRolloutRehearsal();console.log(JSON.stringify(report,null,2));
  if(report.status !== "passed") process.exitCode=1;
}
