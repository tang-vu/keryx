/** Read direct and delay-loaded DLL names from an x64 PE image. */
export function importedDlls(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 0x100 || bytes.toString("ascii", 0, 2) !== "MZ") {
    throw Error("Expected an x64 PE executable");
  }
  const within = (offset, length) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > bytes.length) {
      throw Error("PE import table points outside the executable");
    }
    return offset;
  };
  const u16 = offset => bytes.readUInt16LE(within(offset, 2));
  const u32 = offset => bytes.readUInt32LE(within(offset, 4));
  const pe = u32(0x3c);
  if (bytes.toString("ascii", within(pe, 4), pe + 4) !== "PE\0\0" || u16(pe + 4) !== 0x8664) {
    throw Error("Expected an x64 PE executable");
  }
  const sectionCount = u16(pe + 6);
  const optionalSize = u16(pe + 20);
  const optional = pe + 24;
  if (sectionCount < 1 || sectionCount > 96 || optionalSize < 112 + 14 * 8
    || u16(optional) !== 0x20b || u32(optional + 108) < 14) {
    throw Error("Unsupported x64 PE import layout");
  }
  const directory = optional + 112;
  const sectionsAt = optional + optionalSize;
  within(sectionsAt, sectionCount * 40);
  const headerSize = u32(optional + 60);
  const rvaOffset = rva => {
    if (rva < headerSize) return within(rva, 1);
    for (let index = 0; index < sectionCount; index++) {
      const section = sectionsAt + index * 40;
      const address = u32(section + 12);
      const rawSize = u32(section + 16);
      const rawAt = u32(section + 20);
      if (rva >= address && rva - address < rawSize) return within(rawAt + rva - address, 1);
    }
    throw Error("PE import RVA does not map to file bytes");
  };
  const dllName = rva => {
    const start = rvaOffset(rva);
    let end = start;
    while (end - start < 260 && end < bytes.length && bytes[end] !== 0) {
      if (bytes[end] < 0x20 || bytes[end] > 0x7e) throw Error("Invalid PE import DLL name");
      end++;
    }
    if (end === start || end === bytes.length || end - start === 260) throw Error("Invalid PE import DLL name");
    const name = bytes.toString("ascii", start, end);
    if (!/^[A-Za-z0-9_.-]+\.dll$/i.test(name)) throw Error("Invalid PE import DLL name");
    return name;
  };
  const imports = [];
  for (const [index, descriptorSize, nameAt, delay] of [[1, 20, 12, false], [13, 32, 4, true]]) {
    const rva = u32(directory + index * 8);
    const size = u32(directory + index * 8 + 4);
    if (!rva && !size) continue;
    if (!rva || size < descriptorSize || size > 1024 * descriptorSize) {
      throw Error("Invalid PE import directory size");
    }
    const start = rvaOffset(rva);
    within(start, size);
    let terminated = false;
    for (let at = start; at + descriptorSize <= start + size; at += descriptorSize) {
      let zero = true;
      for (let byte = at; byte < at + descriptorSize; byte++) {
        if (bytes[byte] !== 0) { zero = false; break; }
      }
      if (zero) { terminated = true; break; }
      if (delay && (u32(at) & 1) !== 1) throw Error("Unsupported PE delay-import address mode");
      imports.push(dllName(u32(at + nameAt)));
    }
    if (!terminated) throw Error("PE import directory has no terminator");
  }
  return imports;
}

export function assertNoExternalMsvcCrt(bytes, label) {
  const forbidden = importedDlls(bytes).filter(name => /^(?:VCRUNTIME|MSVCP|CONCRT|VCOMP)[A-Z0-9_]*\.dll$/i.test(name));
  if (forbidden.length) {
    throw Error(`${label} needs an external MSVC runtime: ${[...new Set(forbidden)].join(", ")}`);
  }
}
