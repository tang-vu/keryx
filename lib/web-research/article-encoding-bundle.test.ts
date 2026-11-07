import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { ARTICLE_ENCODINGS, decodedArticleHtml, encodedArticleBytes } from "../../test-support/article-encoding-fixtures";

it("decodes the actual CJS-bundled helper in a fresh Node process without workspace package fallback", async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
    import{readFileSync}from'node:fs';import{decodeArticleText}from'./lib/web-research/article-encoding';
    const inputs=JSON.parse(readFileSync(0,'utf8'));
    process.stdout.write(JSON.stringify(inputs.map(input=>decodeArticleText(Buffer.from(input.hex,'hex'),input.type,input.charset))));
  ` }, bundle: true, write: false, platform: "node", format: "cjs", target: "node24" });
  const guard = `(()=>{const mod=require('node:module'),load=mod._load,allowed=new Set(mod.builtinModules.map(name=>name.replace(/^node:/,'')));
    mod._load=function(name,...args){if(!allowed.has(name.replace(/^node:/,'')))throw new Error('Unexpected external package: '+name);
      return load.call(this,name,...args)};})();\n`;
  const inputs = ARTICLE_ENCODINGS.flatMap(fixture => [
    { hex: encodedArticleBytes(fixture).toString("hex"), type: "text/html", charset: fixture.charset },
    { hex: encodedArticleBytes(fixture, `<meta charset="${fixture.charset}">`).toString("hex"), type: "text/html" },
  ]);
  const directory = mkdtempSync(join(tmpdir(), "keryx-article-encoding-bundle-"));
  try {
    const entry = join(directory, "decode.cjs"); writeFileSync(entry, guard + result.outputFiles[0].text);
    const output = execFileSync(process.execPath, ["--max-old-space-size=64", entry], { cwd: directory,
      input: JSON.stringify(inputs), encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true,
      env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "", KERYX_FORCE_OFFLINE: "1" } });
    expect(JSON.parse(output)).toEqual(ARTICLE_ENCODINGS.flatMap(fixture => [decodedArticleHtml(fixture), decodedArticleHtml(fixture, `<meta charset="${fixture.charset}">`)]));
    expect(result.warnings).toEqual([]);
  } finally {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + "keryx-article-encoding-bundle-")) throw new Error("Unexpected bundle fixture path");
    rmSync(directory, { recursive: true });
  }
});
