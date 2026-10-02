import { DatabaseSync } from "node:sqlite";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { GATEWAY_FUNDING_SCHEMA, GATEWAY_FUNDING_INDEXES } from "./gateway-funding-sqlite-schema";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";

let expectedProfiles: readonly string[] | undefined;
let mainnetProfiles: readonly string[] | undefined;
/** Exact source profile. Only explicit enrollment objects are excluded. Never repairs. */
export function supportedSqliteApplicationProfiles(mainnet = false): readonly string[] {
  if (mainnet) {
    if (!mainnetProfiles) {
      const reference = new DatabaseSync(":memory:");
      try {
        installMainnetApplicationSchema(reference);
        mainnetProfiles = Object.freeze([sqliteApplicationSchemaProfile(reference, new Set())]);
      } finally { reference.close(); }
    }
    return mainnetProfiles;
  }
  if (!expectedProfiles) {
    const reference = new DatabaseSync(":memory:");
    try {
      installSqliteApplicationSchema(reference);
      const application = sqliteApplicationSchemaProfile(reference, new Set());
      for (const sql of Object.values(GATEWAY_FUNDING_SCHEMA)) reference.exec(sql);
      for (const sql of Object.values(GATEWAY_FUNDING_INDEXES)) reference.exec(sql);
      expectedProfiles = Object.freeze([application, sqliteApplicationSchemaProfile(reference, new Set())]);
    } finally { reference.close(); }
  }
  return expectedProfiles;
}

