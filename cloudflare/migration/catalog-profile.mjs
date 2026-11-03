/** Generate only from compiled source in an isolated in-memory reference DB. */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { CATALOG_SQL } from "./src/catalog-schema.mjs";

const db = new DatabaseSync(":memory:");
let objects;
try {
  db.exec(CATALOG_SQL);
  objects = db.prepare("SELECT name,type,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name").all()
    .map(row => [row.name, row.type, row.sql]);
} finally { db.close(); }
const expected = JSON.stringify({ format: "keryx-managed-catalog-schema-v1",
  sourceSha256: createHash("sha256").update(CATALOG_SQL).digest("hex"), objects }, null, 2) + "\n";
const file = new URL("./src/catalog-profile.json", import.meta.url);
if (process.argv.includes("--write")) await writeFile(file, expected);
else if (!isDeepStrictEqual(JSON.parse(await readFile(file, "utf8")), JSON.parse(expected))) throw new Error("Review and regenerate source-known catalog schema profile");
console.log("Source-known catalog schema profile verified (" + objects.length + " objects)");
