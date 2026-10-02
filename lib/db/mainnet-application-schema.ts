import type { DatabaseSync } from "node:sqlite";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { SESSION_GRANT_CONSENTS_SQL } from "./session-grant-consents";
/** Fresh mainnet namespace only. Existing deployed stores require a separately reviewed migration. */
export function installMainnetApplicationSchema(db: DatabaseSync): void {
  installSqliteApplicationSchema(db);
  db.exec(SESSION_GRANT_CONSENTS_SQL);
  db.exec("ALTER TABLE browser_journal_bindings ADD COLUMN payment_context TEXT CHECK(payment_context IS NULL OR json_valid(payment_context))");
  db.exec(`CREATE TRIGGER mainnet_browser_binding_immutable BEFORE UPDATE ON browser_journal_bindings
    WHEN NEW.nonce IS NOT OLD.nonce OR NEW.requirements IS NOT OLD.requirements OR NEW.payment_metadata IS NOT OLD.payment_metadata
      OR (OLD.payment_context IS NOT NULL AND NEW.payment_context IS NOT OLD.payment_context)
      OR (NEW.payment_context IS NOT OLD.payment_context AND NOT EXISTS(SELECT 1 FROM payment_events
        WHERE id='x402:'||OLD.nonce AND authorization_phase='prepared'))
    BEGIN SELECT RAISE(ABORT,'original mainnet challenge immutable'); END;
    CREATE TRIGGER mainnet_browser_binding_retained BEFORE DELETE ON browser_journal_bindings
    BEGIN SELECT RAISE(ABORT,'original mainnet challenge retained'); END;`);
}
