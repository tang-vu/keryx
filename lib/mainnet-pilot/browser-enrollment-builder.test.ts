import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { publicMainnetEnrollmentDigest } from "./public-enrollment";
const script = resolve("scripts/build-mainnet-browser-enrollment.mts"), tsx = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;
describe("offline public enrollment builder", () => {
  it("binds clean committed source, emits roundtrippable public pins and refuses stale/dirty/escaped outputs", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "keryx-enrollment-"));
    try {
      const git = (...args: string[]) => execFileSync("git",args,{cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
      git("init");git("config","user.name","Synthetic fixture");git("config","user.email","fixture@example.invalid");
      writeFileSync(resolve(root,".gitignore"),".artifacts/\n");writeFileSync(resolve(root,"source.txt"),"reviewed source\n");
      git("add",".");git("commit","-m","test: synthetic source");const releaseCommit=git("rev-parse","HEAD");
      const input={format:"keryx-mainnet-enrollment-v1",candidateDigest:"aa".repeat(32),releaseCommit,origin:"https://pilot.test",network:ARC_MAINNET_PROFILE,
        registryAddress:`0x${"11".repeat(20)}`,invitedBuyers:[`0x${"22".repeat(20)}`],retainedTestnetSigners:[`0x${"33".repeat(20)}`],
        approvedSourceIds:[`0x${"44".repeat(32)}`],approvedCreatorAddresses:[`0x${"55".repeat(20)}`],approvedPayoutAddresses:[`0x${"66".repeat(20)}`],
        limits:{totalMicros:1000000,perBuyerMicros:250000,perAskMicros:50000,perPaymentMicros:10000,maxAsks:20},epoch:"fixture",expiresAtSeconds:Math.floor(Date.now()/1000)+3600};
      const artifactRoot=resolve(root,".artifacts/mainnet-pilot");mkdirSync(artifactRoot,{recursive:true});const inputPath=resolve(artifactRoot,"input.json");
      writeFileSync(inputPath,JSON.stringify(input));
      const run=(output:string)=>spawnSync(process.execPath,["--import",tsx,script,"--input",inputPath,"--output",output],{cwd:root,encoding:"utf8"});
      const output=resolve(artifactRoot,"enrollment.json"),result=run(output);expect(result.status,result.stderr).toBe(0);
      const digest=await publicMainnetEnrollmentDigest(input);expect(JSON.parse(result.stdout)).toMatchObject({enrollmentDigest:digest,launchAuthorized:false,releaseCommit});
      expect(JSON.parse(readFileSync(output,"utf8"))).toEqual(input);
      const env=execFileSync(process.execPath,[`--env-file=${output}.public.env`,"-e","process.stdout.write(JSON.stringify({data:JSON.parse(process.env.NEXT_PUBLIC_KERYX_MAINNET_ENROLLMENT_JSON),digest:process.env.NEXT_PUBLIC_KERYX_MAINNET_ENROLLMENT_DIGEST}))"],{encoding:"utf8"});
      expect(JSON.parse(env)).toEqual({data:input,digest});
      expect(run(output).status).not.toBe(0);expect(run(resolve(root,"escaped.json")).status).not.toBe(0);
      const paired=resolve(artifactRoot,"paired.json");writeFileSync(`${paired}.public.env`,"retained\n");expect(run(paired).status).not.toBe(0);expect(existsSync(paired)).toBe(false);
      const redirected=resolve(root,".artifacts/redirected");mkdirSync(redirected);symlinkSync(redirected,resolve(artifactRoot,"redirect"),process.platform==="win32"?"junction":"dir");
      expect(run(resolve(artifactRoot,"redirect/escaped.json")).status).not.toBe(0);expect(existsSync(resolve(redirected,"escaped.json"))).toBe(false);
      writeFileSync(resolve(root,"untracked-source.ts"),"export const unreviewed=true;\n");expect(run(resolve(artifactRoot,"untracked.json")).status).not.toBe(0);
      rmSync(resolve(root,"untracked-source.ts"));
      writeFileSync(inputPath,"{private-sentinel-malformed}");const refused=run(resolve(artifactRoot,"bad.json"));expect(refused.stderr).not.toContain("private-sentinel");
      writeFileSync(inputPath," ".repeat(65537));expect(run(resolve(artifactRoot,"oversized.json")).status).not.toBe(0);
      writeFileSync(inputPath,JSON.stringify({...input,releaseCommit:"00".repeat(20)}));expect(run(resolve(artifactRoot,"stale.json")).status).not.toBe(0);
      writeFileSync(inputPath,JSON.stringify(input));writeFileSync(resolve(root,"source.txt"),"unreviewed change\n");
      expect(run(resolve(artifactRoot,"dirty.json")).status).not.toBe(0);
    } finally { rmSync(root,{recursive:true,force:true}); }
  });
});
