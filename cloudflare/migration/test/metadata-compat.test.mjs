import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { patchMetadataAlternates } from "../src/metadata-compat.mjs";

test("pinned metadata renderer preserves alternate arrays, titles, strings and canonical URL", async () => {
  const filename = fileURLToPath(import.meta.resolve("vinext/shims/metadata"));
  const source = await readFile(filename, "utf8");
  const patched = patchMetadataAlternates(source);
  assert.throws(() => patchMetadataAlternates(source + "\n"), /changed/);
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
  const base = resolve(common, "../.local/tmp/cloudflare-metadata-tests");
  await mkdir(base, { recursive: true });
  const folder = await mkdtemp(resolve(base, "case-"));
  const output = resolve(folder, "metadata.mjs");
  const originalUrl = pathToFileURL(filename);
  const code = patched.replace(/from "([^"]+)"/g, (_match, specifier) => {
    const url = specifier.startsWith(".") ? new URL(specifier, originalUrl).href
      : pathToFileURL(createRequire(originalUrl).resolve(specifier)).href;
    return `from ${JSON.stringify(url)}`;
  });
  try {
    await writeFile(output, code);
    const { MetadataHead } = await import(pathToFileURL(output).href);
    const tree = MetadataHead({ metadata: { metadataBase: new URL("https://fixture.invalid"), alternates: {
      canonical: "/answers", languages: { en: "/answers", vi: [{ url: "/vi/answers", title: "Vietnamese" }] },
      media: { print: [{ url: "/print", title: "Print" }] },
      types: { "application/atom+xml": [{ url: "/answers/feed.xml", title: "Archive" }, { url: "/second.xml", title: "Second" }] },
    } } });
    const links = tree.props.children.filter(element => element.type === "link").map(element => element.props);
    assert.equal(links.length, 6);
    assert.equal(links[0].href, "https://fixture.invalid/answers");
    assert.deepEqual(links.filter(link => link.type === "application/atom+xml").map(link => [link.href, link.title]), [
      ["https://fixture.invalid/answers/feed.xml", "Archive"], ["https://fixture.invalid/second.xml", "Second"],
    ]);
    assert.equal(links.find(link => link.hrefLang === "vi").title, "Vietnamese");
    assert.equal(links.find(link => link.media === "print").title, "Print");
  } finally { await unlink(output).catch(() => {}); await rmdir(folder); }
});
