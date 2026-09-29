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

// Windows' legacy icon APIs expect bitmap frames for taskbar-sized images.
// Keep only the 256 px Explorer frame as PNG. The XOR pixels and 1-bit AND
// transparency mask are stored bottom-up, each mask row padded to 32 bits.
async function bitmapIconFrame(png, size) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== size || info.height !== size || info.channels !== 4) {
    throw new Error(`Unexpected ${size}px icon frame dimensions`);
  }
  const maskStride = Math.ceil(size / 32) * 4;
  const pixels = Buffer.alloc(size * size * 4);
  const mask = Buffer.alloc(maskStride * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const source = (y * size + x) * 4;
      const target = ((size - 1 - y) * size + x) * 4;
      pixels[target] = data[source + 2];
      pixels[target + 1] = data[source + 1];
      pixels[target + 2] = data[source];
      pixels[target + 3] = data[source + 3];
      if (data[source + 3] === 0) {
        mask[(size - 1 - y) * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(pixels.length + mask.length, 20);
  return Buffer.concat([header, pixels, mask]);
}

const pngs = await Promise.all(sizes.map(render));
const images = await Promise.all(pngs.map((png, index) =>
  sizes[index] === 256 ? png : bitmapIconFrame(png, sizes[index])));
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
