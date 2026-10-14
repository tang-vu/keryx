import { DatabaseSync } from "node:sqlite";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { GATEWAY_FUNDING_SCHEMA, GATEWAY_FUNDING_INDEXES } from "./gateway-funding-sqlite-schema";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";

let expectedProfiles: readonly string[] | undefined;
let mainnetProfiles: readonly string[] | undefined;
/** Exact source profile. Only explicit enrollment objects are excluded. Never repairs. */
export function supportedSqliteApplicationProfiles(mainnet = false): readonly string[] {
  if (mainnet) {
    if (!mainnetProfiles) {
      const profiles: string[] = [];
      for (const publicReferenceArchive of [false, true]) {
        const reference = new DatabaseSync(":memory:");
        try {
          reference.exec("BEGIN");
          installMainnetApplicationSchema(reference, { publicReferenceArchive });
          profiles.push(sqliteApplicationSchemaProfile(reference, new Set()));
          installNativeUserDomainSchema(reference);
          profiles.push(sqliteApplicationSchemaProfile(reference, new Set()));
          reference.exec("COMMIT");
        } finally { reference.close(); }
      }
      mainnetProfiles = Object.freeze(profiles);
    }
    return mainnetProfiles;
  }
  if (!expectedProfiles) {
    const profiles: string[] = [];
    for (const publicReferenceArchive of [false, true]) {
      const reference = new DatabaseSync(":memory:");
      try {
        installSqliteApplicationSchema(reference, { publicReferenceArchive });
        profiles.push(sqliteApplicationSchemaProfile(reference, new Set()));
        for (const sql of Object.values(GATEWAY_FUNDING_SCHEMA)) reference.exec(sql);
        for (const sql of Object.values(GATEWAY_FUNDING_INDEXES)) reference.exec(sql);
        profiles.push(sqliteApplicationSchemaProfile(reference, new Set()));
      } finally { reference.close(); }
    }
    expectedProfiles = Object.freeze(profiles);
  }
  return expectedProfiles;
}

