/** Fixed Node/TypeScript oracle vectors for the read-only v1 Rust candidate. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { canonicalJson } from "../lib/canonical-json.ts";
import { sha256 } from "../lib/research-receipt-integrity.ts";

type JsonVector = {
  label: string;
  raw: string;
  ordinary: string;
  canonical: string;
  digest: `sha256:${string}`;
  keys?: string[];
};

export const jsonVectors: JsonVector[] = [
  { label: "lone high value", raw: String.raw`{"v":"\ud800"}`,
    ordinary: String.raw`{"v":"\ud800"}`, canonical: String.raw`{"v":"\ud800"}`,
    digest: "sha256:d2aa26b425a595573d6ce4fcdd6d58bd66e0c35a8ff14cc1c7ded84fdf726886" },
  { label: "lone low key", raw: String.raw`{"\udc00":"value"}`,
    ordinary: String.raw`{"\udc00":"value"}`, canonical: String.raw`{"\udc00":"value"}`,
    digest: "sha256:57459120775ac92476812eca3ce92d466a471c31da86cd41e9357ed9189af372",
    keys: ["\udc00"] },
  { label: "nested unused surrogate key and value", raw: String.raw`{"unused":{"\ud800":"\udc00"},"accepted":true}`,
    ordinary: String.raw`{"unused":{"\ud800":"\udc00"},"accepted":true}`,
    canonical: String.raw`{"accepted":true,"unused":{"\ud800":"\udc00"}}`,
    digest: "sha256:3df2ae2d9739d37bb046cbc1536f4e65a6931a5140040dcd70440be8eba3bd06" },
  { label: "escaped equivalent duplicate surrogate keys are last wins",
    raw: String.raw`{"\ud800":"first","\uD800":"last"}`,
    ordinary: String.raw`{"\ud800":"last"}`, canonical: String.raw`{"\ud800":"last"}`,
    digest: "sha256:7c4ef495948efd1546a5c72b80788489cb22a82d5f4f2d0e74267119305b618d",
    keys: ["\ud800"] },
  { label: "escaped equivalent ordinary keys are last wins", raw: String.raw`{"a":1,"\u0061":2}`,
    ordinary: String.raw`{"a":2}`, canonical: String.raw`{"a":2}`,
    digest: "sha256:7e8059f495589fcd981232cc11d00b00da3802c01d688fa1cf1f6bed6e5bb33c",
    keys: ["a"] },
  { label: "duplicate surrogate key keeps first insertion position among distinct keys",
    raw: String.raw`{"first":1,"\ud800":"old","middle":2,"\uD800":"new","last":3}`,
    ordinary: String.raw`{"first":1,"\ud800":"new","middle":2,"last":3}`,
    canonical: String.raw`{"first":1,"last":3,"middle":2,"\ud800":"new"}`,
    digest: "sha256:4573ee4c2e8519a980e0e82faf0cb815bf95cee2690f3e4494eef62c95219d43",
    keys: ["first", "\ud800", "middle", "last"] },
  { label: "astral before private use in UTF-16 key order", raw: String.raw`{"\ue000":1,"\ud83d\ude00":2}`,
    ordinary: `{"\uE000":1,"😀":2}`, canonical: `{"😀":2,"\uE000":1}`,
    digest: "sha256:28c95d1bbb2209223307e62f489020e8f9e0cfa16adf2daf6d88127a1e8dd22a",
    keys: ["\uE000", "😀"] },
  { label: "array index enumeration differs from canonical lexical key order",
    raw: String.raw`{"2":"two","10":"ten","01":"leading","0":"zero"}`,
    ordinary: `{"0":"zero","2":"two","10":"ten","01":"leading"}`,
    canonical: `{"0":"zero","01":"leading","10":"ten","2":"two"}`,
    digest: "sha256:195dce76872d1a876bedac6e76f14fd97b4aedf2dc6da3deb3b411d327b0677b",
    keys: ["0", "2", "10", "01"] },
  { label: "last JavaScript array index versus non-index and leading zero",
    raw: String.raw`{"4294967295":"nonindex","4294967294":"index","04294967294":"leading"}`,
    ordinary: String.raw`{"4294967294":"index","4294967295":"nonindex","04294967294":"leading"}`,
    canonical: String.raw`{"04294967294":"leading","4294967294":"index","4294967295":"nonindex"}`,
    digest: "sha256:86f28ce2f86e234ea7c392f4b8eb285dd163f0ecba4ede3898d5c66ba64c511a",
    keys: ["4294967294", "4294967295", "04294967294"] },
  { label: "literal backslash-u remains text", raw: String.raw`{"v":"\\ud800"}`,
    ordinary: String.raw`{"v":"\\ud800"}`, canonical: String.raw`{"v":"\\ud800"}`,
    digest: "sha256:2eeb4121ae3723be91bf8db16c6c5441decb032f3179df1ccb62075b6649ab0c" },
  { label: "control escapes and literal line separator", raw: String.raw`{"z":"\b\f\n\r\t\u0000\u2028","\u0001":"ctrl"}`,
    ordinary: `{"z":"\\b\\f\\n\\r\\t\\u0000\u2028","\\u0001":"ctrl"}`,
    canonical: `{"\\u0001":"ctrl","z":"\\b\\f\\n\\r\\t\\u0000\u2028"}`,
    digest: "sha256:1cdcf80d12820bb96c87222db9036712b157ca1c0570921c625059c54c0ec215" },
  { label: "negative zero, subnormal, max finite and unsafe integer",
    raw: String.raw`{"n":-0,"sub":5e-324,"large":1.7976931348623157e308,"unsafe":9007199254740993}`,
    ordinary: `{"n":0,"sub":5e-324,"large":1.7976931348623157e+308,"unsafe":9007199254740992}`,
    canonical: `{"large":1.7976931348623157e+308,"n":0,"sub":5e-324,"unsafe":9007199254740992}`,
    digest: "sha256:ef42df078eda9b66033455f802b75130118058f37b882ab22b927f76fd0f00e6" },
];

export const nonFiniteVectors = [
  { label: "positive overflow", raw: String.raw`{"n":1e400}`, ordinary: `{"n":null}` },
  { label: "negative overflow", raw: String.raw`{"n":-1e400}`, ordinary: `{"n":null}` },
] as const;

export const answerVectors = [
  { label: "lone high answer", value: "\ud800", json: String.raw`"\ud800"`,
    digest: "sha256:83d544ccc223c057d2bf80d3f2a32982c32c3c0db8e2674820da5064783fb097" },
  { label: "lone low answer", value: "\udc00", json: String.raw`"\udc00"`,
    digest: "sha256:83d544ccc223c057d2bf80d3f2a32982c32c3c0db8e2674820da5064783fb097" },
] as const;

export type ByteVector = {
  label: string;
  bytes: Buffer;
  boundedReaderAccepts: boolean;
  directUtf8StringAccepts: boolean;
};

export const byteVectors: ByteVector[] = [
  { label: "leading UTF-8 BOM", bytes: Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
    boundedReaderAccepts: true, directUtf8StringAccepts: false },
  { label: "raw surrogate UTF-8 is invalid", bytes: Buffer.concat([
    Buffer.from('{"x":"'), Buffer.from([0xed, 0xa0, 0x80]), Buffer.from('"}')]),
    boundedReaderAccepts: false, directUtf8StringAccepts: true },
  { label: "invalid continuation byte", bytes: Buffer.concat([
    Buffer.from('{"x":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')]),
    boundedReaderAccepts: false, directUtf8StringAccepts: true },
  { label: "malformed Unicode escape", bytes: Buffer.from(String.raw`{"x":"\ud80g"}`),
    boundedReaderAccepts: false, directUtf8StringAccepts: false },
  { label: "malformed escape in overwritten duplicate still refuses",
    bytes: Buffer.from(String.raw`{"x":"\ud80g","x":"valid"}`),
    boundedReaderAccepts: false, directUtf8StringAccepts: false },
];

function parses(text: string): boolean {
  try { JSON.parse(text); return true; } catch { return false; }
}

export function assertNodeLosslessOracle(): { json: number; nonFinite: number; answer: number; bytes: number } {
  for (const vector of jsonVectors) {
    const value = JSON.parse(vector.raw);
    assert.equal(JSON.stringify(value), vector.ordinary, `${vector.label}: ordinary JSON`);
    const canonical = canonicalJson(value);
    assert.equal(canonical, vector.canonical, `${vector.label}: canonical UTF-16 JSON`);
    assert.equal(sha256(canonical), vector.digest, `${vector.label}: canonical digest`);
    if (vector.keys) assert.deepEqual(Object.keys(value), vector.keys, `${vector.label}: JavaScript keys`);
  }
  for (const vector of nonFiniteVectors) {
    const value = JSON.parse(vector.raw);
    assert.equal(JSON.stringify(value), vector.ordinary, `${vector.label}: ordinary JSON null`);
    assert.throws(() => canonicalJson(value), /non-finite number/, `${vector.label}: canonical refusal`);
  }
  for (const vector of answerVectors) {
    assert.equal(JSON.stringify(vector.value), vector.json, `${vector.label}: lossless JSON code unit`);
    assert.equal(sha256(vector.value), vector.digest, `${vector.label}: Node UTF-8 replacement hash`);
    assert.deepEqual(Buffer.from(vector.value, "utf8"), Buffer.from("\ufffd", "utf8"));
  }
  for (const vector of byteVectors) {
    let boundedAccepts = false;
    try { boundedAccepts = parses(new TextDecoder("utf-8", { fatal: true }).decode(vector.bytes)); }
    catch { /* fatal UTF-8 refusal */ }
    assert.equal(boundedAccepts, vector.boundedReaderAccepts, `${vector.label}: bounded reader`);
    assert.equal(parses(vector.bytes.toString("utf8")), vector.directUtf8StringAccepts,
      `${vector.label}: direct UTF-8 string`);
  }
  return { json: jsonVectors.length, nonFinite: nonFiniteVectors.length,
    answer: answerVectors.length, bytes: byteVectors.length };
}

/** Preserve raw token spellings in a TS-written synthetic receipt after its digest is fixed. */
export async function embedRawReceiptProbe(file: string, field: string, raw: string): Promise<void> {
  const receipt = JSON.parse(await readFile(file, "utf8"));
  const normalized = JSON.stringify(JSON.parse(raw));
  const compact = JSON.stringify(receipt);
  const needle = `${JSON.stringify(field)}:${normalized}`;
  assert.equal(compact.split(needle).length, 2, `expected one ${field} probe in receipt`);
  const changed = compact.replace(needle, () => `${JSON.stringify(field)}:${raw}`);
  assert.equal(JSON.stringify(JSON.parse(changed)), compact,
    "raw probe changed the TypeScript-serialized receipt value");
  await writeFile(file, changed);
}
