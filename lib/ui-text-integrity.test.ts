import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MOJIBAKE = ["Â·", "â€”", "â€“", "â€¦", "â†", "ðŸ", "\uFFFD"];

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [file] : [];
  });
}

describe("public UI text integrity", () => {
  it("contains no common UTF-8 mojibake markers", () => {
    const files = [...sourceFiles("app"), ...sourceFiles("components")];
    const offenders = files.flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      const markers = MOJIBAKE.filter((marker) => text.includes(marker));
      return markers.length > 0 ? [{ file, markers }] : [];
    });

    expect(offenders).toEqual([]);
  });
});
