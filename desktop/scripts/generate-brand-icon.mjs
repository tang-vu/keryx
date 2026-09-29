import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "../..");
const output = join(root, "desktop", "assets");
const source = await readFile(join(root, "app", "icon.svg"));
const sizes = [16, 24, 32, 48, 64, 128, 256];

async function render(size) {
  return sharp(source, { density: Math.ceil(size / 160 * 96) })
    .resize(size, size)
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

await mkdir(output, { recursive: true });
await writeFile(join(output, "icon.png"), await render(512));

// Windows ICO entries can contain PNG images. Include the small taskbar sizes
// and a 256 px image for Explorer; 0 encodes 256 in the ICO directory.
const images = await Promise.all(sizes.map(render));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((png, index) => {
  const entry = 6 + index * 16;
  header.writeUInt8(sizes[index] === 256 ? 0 : sizes[index], entry);
  header.writeUInt8(sizes[index] === 256 ? 0 : sizes[index], entry + 1);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
await writeFile(join(output, "icon.ico"), Buffer.concat([header, ...images]));
