import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));

// GHSA-wq5f-xc86-pv6w: the patched prebuilt closure supplies librsvg 2.63.2.
// Check every locked native platform, not only the binary selected on this host.
test("Next resolves the patched sharp and all platform lock entries remain fixed", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url)));
  assert.equal(manifest.overrides.next.sharp, "0.35.5");
  assert.equal(nextRequire.resolve("sharp"), require.resolve("sharp"));
  const sharp = lock.packages["node_modules/sharp"];
  assert.equal(sharp.version, "0.35.5");
  assert.match(sharp.integrity, /^sha512-/);
  for (const [name, version] of Object.entries(sharp.optionalDependencies)) {
    assert.equal(version, name.includes("sharp-libvips-") ? "1.3.4" : "0.35.5", name);
    const entry = lock.packages[`node_modules/${name}`];
    assert.ok(entry, `Missing locked platform ${name}`);
    assert.equal(entry.version, version, name);
    assert.match(entry.integrity, /^sha512-/, name);
  }
});

const fixture = String.raw`
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
const nextRequire = createRequire(require.resolve("next/package.json"));
try {
  const sharp = nextRequire("sharp");
  assert.equal(sharp.versions.sharp, "0.35.5");
  assert.equal(sharp.versions.rsvg, "2.63.2");
  sharp.cache(false);
  sharp.concurrency(1);
  const { imageConfigDefault } = nextRequire("next/dist/shared/lib/image-config");
  assert.equal(imageConfigDefault.dangerouslyAllowSVG, false);
  const { getSharp, optimizeImage } = nextRequire("next/dist/server/image-optimizer");
  assert.equal(getSharp(1), sharp);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#ff0000"/></svg>');
  const options = { limitInputPixels: 4096, failOn: "warning" };
  const png = await sharp(svg, options).resize(16, 16).png().toBuffer();
  const raster = await sharp(png, options).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([raster.info.width, raster.info.height, raster.info.channels], [16, 16, 4]);
  assert.deepEqual([...raster.data.subarray(0, 4)], [255, 0, 0, 255]);
  const optimized = await optimizeImage({ buffer: png, contentType: "image/webp", quality: 75, width: 8 });
  const result = await sharp(optimized, options).metadata();
  assert.equal(result.format, "webp");
  assert.equal(result.width, 8);
  assert.equal(result.height, 8);
  await assert.rejects(() => sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>'), options).png().toBuffer());
  await assert.rejects(() => sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16384" height="16384"/>'), options).png().toBuffer());
  // Exercise the existing desktop brand generator's SVG->PNG->alpha APIs in memory.
  const brand = readFileSync("app/icon.svg");
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
    const rendered = await sharp(brand, { density: Math.ceil(size / 160 * 96), limitInputPixels: 1048576 })
      .resize(size, size).png({ compressionLevel: 9, palette: false }).toBuffer();
    const rgba = await sharp(rendered).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([rgba.info.width, rgba.info.height, rgba.info.channels], [size, size, 4]);
  }
  console.log(JSON.stringify({ sharp: sharp.versions.sharp, librsvg: sharp.versions.rsvg, nextOptimizer: true, malformedRejected: true, pixelsBounded: true, desktopBrand: true }));
} catch {
  console.error("Image dependency fixture failed.");
  process.exitCode = 1;
}
`;

test("patched native decoder and actual Next optimizer preserve bounded SVG/image contracts", () => {
  // No env files, credentials or provider/network APIs are loaded. This real child
  // has a wall-time/output limit and a JS heap cap; the latter is not an OS RSS cap.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => [
    "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "HOME", "USERPROFILE",
  ].includes(key.toUpperCase())));
  const output = execFileSync(process.execPath,
    ["--max-old-space-size=64", "--input-type=module", "-"], {
      input: fixture, env, encoding: "utf8", timeout: 15_000,
      maxBuffer: 8192, stdio: ["pipe", "pipe", "pipe"],
    });
  assert.deepEqual(JSON.parse(output), {
    sharp: "0.35.5", librsvg: "2.63.2", nextOptimizer: true,
    malformedRejected: true, pixelsBounded: true, desktopBrand: true,
  });
});
