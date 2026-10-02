import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, symlink, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { keccak256, toBytes } from "viem";
import { loadReviewedRegistryArtifact } from "../mainnet-unsigned-setup.mjs";
import { registryWorkspaceFiles, verifyCompiledRegistry, writeRegistryWorkspace } from "./mainnet-registry-workspace.mjs";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) {
  if (!directory.startsWith(join(tmpdir(), "keryx-remix-"))) throw new Error("Fixture cleanup path refused");
  await rm(directory, {recursive:true,force:true});
} });
async function compilerOutput() {
  const artifact = await loadReviewedRegistryArtifact();
  return { contracts: { "contracts/source-registry.sol": { SourceRegistry: { abi: artifact.abi,
    evm: {bytecode:{object:artifact.bytecode.slice(2)},deployedBytecode:{object:artifact.deployedBytecode.slice(2)}},
    metadata:JSON.stringify({compiler:{version:artifact.compiler},settings:{evmVersion:"paris",optimizer:{enabled:true,runs:200},
      compilationTarget:{"contracts/source-registry.sol":"SourceRegistry"}},sources:{"contracts/source-registry.sol":{
        keccak256:keccak256(toBytes(artifact.compilerInput.sources["contracts/source-registry.sol"].content))}}}) } } } };
}
it("accepts exact pinned standard output and Remix artifact without signing or broadcasting",async()=>{
  const standard=await compilerOutput(),contract=standard.contracts["contracts/source-registry.sol"].SourceRegistry;
  expect(await verifyCompiledRegistry(standard)).toMatchObject({compiledSourceVerified:true,unsignedOnly:true,broadcast:false});
  expect(await verifyCompiledRegistry({abi:contract.abi,metadata:contract.metadata,bytecode:contract.evm.bytecode,deployedBytecode:contract.evm.deployedBytecode})).toMatchObject({compiledSourceVerified:true});
});
it("refuses changed creation/runtime code, ABI, compiler, settings or source provenance",async()=>{
  const original=await compilerOutput();
  for(const field of ["bytecode","deployedBytecode"] as const){const altered=structuredClone(original);altered.contracts["contracts/source-registry.sol"].SourceRegistry.evm[field].object="00";await expect(verifyCompiledRegistry(altered)).rejects.toThrow();}
  const abi=structuredClone(original);abi.contracts["contracts/source-registry.sol"].SourceRegistry.abi=[];await expect(verifyCompiledRegistry(abi)).rejects.toThrow();
  type Metadata={compiler:{version:string};settings:{optimizer:{runs:number};evmVersion:string;compilationTarget:Record<string,string>};sources:Record<string,{keccak256:string}>};
  for(const mutate of [
    (m:Metadata)=>{m.compiler.version="0.8.26";},
    (m:Metadata)=>{m.settings.optimizer.runs=201;},
    (m:Metadata)=>{m.settings.evmVersion="shanghai";},
    (m:Metadata)=>{m.sources["contracts/source-registry.sol"].keccak256=`0x${"0".repeat(64)}`;},
    (m:Metadata)=>{m.settings.compilationTarget={"other.sol":"SourceRegistry"};},
  ]){const altered=structuredClone(original),c=altered.contracts["contracts/source-registry.sol"].SourceRegistry,m=JSON.parse(c.metadata);mutate(m);c.metadata=JSON.stringify(m);await expect(verifyCompiledRegistry(altered)).rejects.toThrow();}
});
it("writes a fresh public workspace, retains exact source and refuses overwrite/junction escape",async()=>{
  const parent=await mkdtemp(join(tmpdir(),"keryx-remix-"));directories.push(parent);
  const files=await registryWorkspaceFiles(`0x${"a".repeat(40)}`,"a".repeat(40)),directory=join(parent,"public-workspace");
  expect(await writeRegistryWorkspace(directory.replaceAll("\\","/"),files)).toMatchObject({publicWorkspaceCreated:true,fileCount:4,unsignedOnly:true,broadcast:false});
  expect(await readFile(join(directory,"contracts/source-registry.sol"),"utf8")).toBe(files["contracts/source-registry.sol"]);
  expect(files["README.md"]).toContain("STOP before approving");expect(files["registry-review.json"]).toContain('"transactionFundingAuthorized": false');
  await expect(writeRegistryWorkspace(directory,files)).rejects.toThrow();
  const link=join(parent,"redirect");await symlink(directory,link,process.platform==="win32"?"junction":"dir");
  await expect(writeRegistryWorkspace(join(link,"escape"),files)).rejects.toThrow();await expect(access(join(directory,"escape"))).rejects.toThrow();
  await expect(writeRegistryWorkspace(join(parent,"other"),{...files,"../escape":"bad"} as typeof files)).rejects.toThrow();
});
