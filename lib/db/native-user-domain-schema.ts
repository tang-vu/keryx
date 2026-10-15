import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ACCOUNT_MEMBERSHIP_SCHEMA_DATA } from "../accounts/sqlite-schema-data";
import { PRIVATE_PROFILES_SQL } from "./private-profiles-sqlite";
import { PROFILE_IDENTITIES_SQL } from "./profile-identities-sqlite";
import { PRIVATE_BIBLIOGRAPHIES_SQL } from "./private-bibliographies-sqlite";
import { DELIVERABLE_ACCEPTANCE_SQL } from "./deliverable-acceptance-sqlite";
import { RUN_CLAIMS_SQL } from "./run-claims-sqlite";
import { RUN_PRIVACY_SQL } from "./run-privacy-sqlite";
import { PUBLIC_PROFILES_SQL } from "./public-profiles-sqlite";
import { DECISION_REVIEWS_SQL } from "./decision-reviews-sqlite";
import { TOPIC_WATCHES_SQL } from "./topic-watches-schema";
import { OWNER_RUN_ASSIGNMENTS_SQL } from "../owner-run-assignments/schema";
import { OWNER269_OCCUPANCY_PROPOSAL } from "../owner-run-assignments/occupancy-proposal";

export { NATIVE_USER_DOMAIN_TABLES } from "./native-user-domain-schema-data";

/** Explicit migration/reference only. No application constructor calls it.
 * The caller owns a transaction and admits the entire old shape first. This
 * installs no user, ownership claim, consent, publication or financial record. */
export function installNativeUserDomainSchema(db: DatabaseSync): void {
  if (!db.isTransaction) throw new Error("Native user-domain installation requires an owned transaction");
  for (const sql of [PRIVATE_PROFILES_SQL, PROFILE_IDENTITIES_SQL, PRIVATE_BIBLIOGRAPHIES_SQL,
    DELIVERABLE_ACCEPTANCE_SQL, RUN_CLAIMS_SQL, RUN_PRIVACY_SQL, PUBLIC_PROFILES_SQL, DECISION_REVIEWS_SQL, TOPIC_WATCHES_SQL]) db.exec(sql);
  for (const entry of ACCOUNT_MEMBERSHIP_SCHEMA_DATA) if (entry.sql !== null) db.exec(entry.sql);
  db.exec(OWNER_RUN_ASSIGNMENTS_SQL);
  for (const entry of OWNER269_OCCUPANCY_PROPOSAL) db.exec(entry.sql + ";");
  db.prepare("INSERT INTO deliverable_acceptance_store(singleton,id) VALUES(1,?)").run(randomUUID());
}
