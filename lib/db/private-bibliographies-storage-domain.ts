import { createHash } from "node:crypto";
import { PRIVATE_BIBLIOGRAPHIES_SQL } from "./private-bibliographies-sqlite";

const table = "private_bibliographies";
const fencePrefix = `storage_fence_${createHash("sha256").update(table).digest("hex").slice(0, 16)}`;

/** Declarative input for ROOT's ONE complete native-user-domain migration.
 * The ordinary SQL remains the source authority. No installer, profile generator,
 * seed, independent optional subset or production migration lives here. */
export const PRIVATE_BIBLIOGRAPHIES_STORAGE_DOMAIN = Object.freeze({
  tables: Object.freeze([table]),
  sql: PRIVATE_BIBLIOGRAPHIES_SQL,
  schema: Object.freeze([
    Object.freeze({ type: "index", name: "sqlite_autoindex_private_bibliographies_1", tbl_name: table, sql: null }),
    Object.freeze({ type: "index", name: "sqlite_autoindex_private_bibliographies_2", tbl_name: table, sql: null }),
    Object.freeze({ type: "table", name: table, tbl_name: table,
      sql: PRIVATE_BIBLIOGRAPHIES_SQL.replace(" IF NOT EXISTS", "").trim().replace(/;$/, "") }),
  ]),
  // Exact names; SQL comes exclusively from the shared identity fence authority
  // with the admitted identity digest/mode. All three must be present and exact.
  fences: Object.freeze([
    Object.freeze({ name: `${fencePrefix}_insert`, table, operation: "INSERT" }),
    Object.freeze({ name: `${fencePrefix}_update`, table, operation: "UPDATE" }),
    Object.freeze({ name: `${fencePrefix}_delete`, table, operation: "DELETE" }),
  ]),
});
