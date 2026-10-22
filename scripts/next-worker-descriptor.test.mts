import { describe, expect, it } from "vitest";
import { nextWorkerDescriptor } from "../test-support/next-worker-descriptor";

const bootstrap = "static/chunks/turbopack-worker-abc.js";
const entry = "static/chunks/mainnet-entry.js", runtime = "static/chunks/runtime.js";
const chunks = [runtime, entry];
const call = (callee = "loader.r(42).a", argument = JSON.stringify(chunks)) =>
  `exports.v(${callee}(${JSON.stringify(bootstrap)},${argument}));`;
function packaged(source = call()) {
  return new Map([
    ["/_next/static/chunks/client.js", source],
    [`/_next/${bootstrap}`, "/* actual inspected bootstrap */"],
    [`/_next/${entry}`, 'throw new Error("Browser session operation refused");'],
    [`/_next/${runtime}`, "/* actual inspected worker runtime */"],
  ]);
}
const find = (source: string) => nextWorkerDescriptor(packaged(source), `/_next/${entry}`);

describe("inspected Next worker reference", () => {
  it.each(["loader.r(42).default", "loader.r(42).a", 'loader.r(42)["a"]', "(loader.r(42).a)"])(
    "resolves the emitted %s module export without relying on its name", callee => {
      expect(find(call(callee))).toEqual({ bootstrap, chunks });
    },
  );
  it("resolves emitted chunk metadata through its literal path", () => {
    expect(find(call(undefined, `[${JSON.stringify(runtime)},{path:${JSON.stringify(entry)},included:[1,2]}]`)))
      .toEqual({ bootstrap, chunks });
  });
  it("deduplicates identical references across emitted chunks", () => {
    const files = packaged(); files.set("/_next/static/chunks/second-client.js", call());
    expect(nextWorkerDescriptor(files, `/_next/${entry}`)).toEqual({ bootstrap, chunks });
  });
  it.each([
    `// ${call()}\nconst text=${JSON.stringify(call())};`,
    call("unrelatedFunction"),
    call(undefined, JSON.stringify([runtime])),
    call(undefined, "getChunks()"),
    call(undefined, `[...getChunks(),${JSON.stringify(entry)}]`),
    call(undefined, `[{get path(){return ${JSON.stringify(entry)}}}]`),
    call(undefined, `[{["pa"+"th"]:${JSON.stringify(entry)}}]`),
    call(undefined, `[{path:${JSON.stringify(entry)},...other}]`),
    call(undefined, JSON.stringify([entry, entry])),
    call(undefined, JSON.stringify([runtime, "https://external.invalid/entry.js", entry])),
    call(undefined, JSON.stringify([runtime, "static/chunks/../entry.js", entry])),
    call(undefined, JSON.stringify([runtime, "static/chunks/missing.js", entry])),
    call().replace("]));", "],true));"),
    call() + "function broken( {",
  ])("refuses unbound, dynamic, malformed or unrelated references %#", source => {
    expect(find(source)).toBeNull();
  });
  it("requires the inspected bootstrap and entry files themselves", () => {
    for (const missing of [bootstrap, entry]) {
      const files = packaged(); files.delete(`/_next/${missing}`);
      expect(nextWorkerDescriptor(files, `/_next/${entry}`)).toBeNull();
    }
  });
  it("refuses two different descriptors for the same worker entry", () => {
    expect(find(call() + call(undefined, JSON.stringify([entry, runtime])))).toBeNull();
  });
});
