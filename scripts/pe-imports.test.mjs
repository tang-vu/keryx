import assert from "node:assert/strict";
import test from "node:test";
import { assertNoExternalMsvcCrt, importedDlls } from "./pe-imports.mjs";

function peWithImport(name, delay = false) {
  const bytes = Buffer.alloc(0x600);
  bytes.write("MZ");
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.write("PE\0\0", 0x80);
  bytes.writeUInt16LE(0x8664, 0x84);
  bytes.writeUInt16LE(1, 0x86);
  bytes.writeUInt16LE(0xf0, 0x94);
  const optional = 0x98;
  bytes.writeUInt16LE(0x20b, optional);
  bytes.writeUInt32LE(0x200, optional + 60);
  bytes.writeUInt32LE(16, optional + 108);
  const directory = optional + 112 + (delay ? 13 : 1) * 8;
  bytes.writeUInt32LE(delay ? 0x1200 : 0x1000, directory);
  bytes.writeUInt32LE(delay ? 64 : 40, directory + 4);
  const section = optional + 0xf0;
  bytes.writeUInt32LE(0x400, section + 8);
  bytes.writeUInt32LE(0x1000, section + 12);
  bytes.writeUInt32LE(0x400, section + 16);
  bytes.writeUInt32LE(0x200, section + 20);
  if (delay) {
    bytes.writeUInt32LE(1, 0x400);
    bytes.writeUInt32LE(0x1300, 0x404);
    bytes.write(name, 0x500, "ascii");
  } else {
    bytes.writeUInt32LE(0x1100, 0x20c);
    bytes.write(name, 0x300, "ascii");
  }
  return bytes;
}

test("package import gate accepts Windows DLLs and rejects a dynamic MSVC C runtime", () => {
  const windows = peWithImport("KERNEL32.dll");
  assert.deepEqual(importedDlls(windows), ["KERNEL32.dll"]);
  assert.doesNotThrow(() => assertNoExternalMsvcCrt(windows, "writer"));
  assert.throws(() => assertNoExternalMsvcCrt(peWithImport("VCRUNTIME140.dll"), "writer"),
    /writer needs an external MSVC runtime: VCRUNTIME140.dll/);
  assert.throws(() => assertNoExternalMsvcCrt(peWithImport("MSVCP140.dll", true), "writer"),
    /writer needs an external MSVC runtime: MSVCP140.dll/);
});

test("malformed import directories fail closed", () => {
  const bytes = peWithImport("KERNEL32.dll");
  bytes.writeUInt32LE(0x9000, 0x20c);
  assert.throws(() => importedDlls(bytes), /PE import RVA/);
  assert.throws(() => importedDlls(Buffer.from("MZ")), /Expected an x64 PE/);
});
