import type { DatabaseSync } from "node:sqlite";

/** Additional pilot policy only. Authorizations retain the shared browser journal schema. */
export function installMainnetPilotSchema(db: DatabaseSync): void {
  db.exec(`CREATE TABLE mainnet_pilot_policy (
    id INTEGER PRIMARY KEY CHECK(id=1), digest TEXT NOT NULL, policy TEXT NOT NULL CHECK(json_valid(policy)));
    CREATE TABLE mainnet_pilot_queries (
      query_id TEXT PRIMARY KEY, owner TEXT NOT NULL, signer TEXT NOT NULL, grant_epoch TEXT NOT NULL,
      allocated_micro INTEGER NOT NULL CHECK(allocated_micro>0), spent_micro INTEGER NOT NULL DEFAULT 0 CHECK(spent_micro>=0),
      created_at TEXT NOT NULL);
    CREATE TABLE mainnet_pilot_settlement_attempts (
      nonce TEXT PRIMARY KEY, header_hash TEXT NOT NULL, claimed_at TEXT NOT NULL);
    CREATE TABLE mainnet_pilot_grant_challenges (
      epoch TEXT PRIMARY KEY, fields TEXT NOT NULL CHECK(json_valid(fields)), valid_until INTEGER NOT NULL,
      consumed_at INTEGER, token_hash TEXT UNIQUE);
    CREATE TRIGGER mainnet_pilot_grant_challenges_binding BEFORE UPDATE ON mainnet_pilot_grant_challenges
      WHEN NEW.epoch IS NOT OLD.epoch OR NEW.fields IS NOT OLD.fields OR NEW.valid_until IS NOT OLD.valid_until
        OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL OR NEW.token_hash IS NULL
      BEGIN SELECT RAISE(ABORT,'pilot grant challenge immutable'); END;
    CREATE TRIGGER mainnet_pilot_grant_challenges_no_delete BEFORE DELETE ON mainnet_pilot_grant_challenges
      BEGIN SELECT RAISE(ABORT,'pilot grant challenge retained'); END;
    CREATE TRIGGER mainnet_pilot_settlement_attempts_no_update BEFORE UPDATE ON mainnet_pilot_settlement_attempts
      BEGIN SELECT RAISE(ABORT,'pilot settlement claim immutable'); END;
    CREATE TRIGGER mainnet_pilot_settlement_attempts_no_delete BEFORE DELETE ON mainnet_pilot_settlement_attempts
      BEGIN SELECT RAISE(ABORT,'pilot settlement claim retained'); END;
    CREATE TRIGGER mainnet_pilot_policy_no_update BEFORE UPDATE ON mainnet_pilot_policy
      BEGIN SELECT RAISE(ABORT,'pilot policy immutable'); END;
    CREATE TRIGGER mainnet_pilot_policy_no_delete BEFORE DELETE ON mainnet_pilot_policy
      BEGIN SELECT RAISE(ABORT,'pilot policy retained'); END;
    CREATE TRIGGER mainnet_pilot_queries_no_delete BEFORE DELETE ON mainnet_pilot_queries
      BEGIN SELECT RAISE(ABORT,'pilot query allocation retained'); END;
    CREATE TRIGGER mainnet_pilot_queries_binding BEFORE UPDATE ON mainnet_pilot_queries
      WHEN NEW.query_id IS NOT OLD.query_id OR NEW.owner IS NOT OLD.owner OR NEW.signer IS NOT OLD.signer
        OR NEW.grant_epoch IS NOT OLD.grant_epoch OR NEW.allocated_micro IS NOT OLD.allocated_micro OR NEW.created_at IS NOT OLD.created_at
      BEGIN SELECT RAISE(ABORT,'pilot query binding immutable'); END;`);
}
