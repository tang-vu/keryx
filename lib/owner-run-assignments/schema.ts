/** Fixed metadata only. Explicit fixture/migration installer; factories execute no DDL.
 * Shared ticket/original occupancy triggers are deliberately NOT installed here:
 * their cross-owner proposal is in the handoff, and fresh apply refuses without them. */
export const OWNER_RUN_ASSIGNMENTS_SQL = `
CREATE TABLE owner269_operations (
  request_id TEXT PRIMARY KEY,
  input_digest TEXT NOT NULL CHECK(length(input_digest)=64 AND input_digest NOT GLOB '*[^a-f0-9]*'),
  event TEXT NOT NULL CHECK(typeof(event)='text' AND length(CAST(event AS BLOB))<=65536 AND json_valid(event))
);
CREATE TABLE owner269_associations (
  assignment_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  recipient_account TEXT NOT NULL,
  recipient_generation TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740990),
  status TEXT NOT NULL CHECK(status IN ('assigned-by-owner','claimed','rejected','revoked')),
  apply_id TEXT NOT NULL REFERENCES owner269_operations(request_id) DEFERRABLE INITIALLY DEFERRED,
  last_operation_id TEXT NOT NULL REFERENCES owner269_operations(request_id) DEFERRABLE INITIALLY DEFERRED,
  state TEXT NOT NULL CHECK(typeof(state)='text' AND length(CAST(state AS BLOB))<=32768 AND json_valid(state))
);
CREATE UNIQUE INDEX owner269_occupancy ON owner269_associations(run_id) WHERE status IN ('assigned-by-owner','claimed');
CREATE INDEX owner269_recipient ON owner269_associations(recipient_account,recipient_generation,status,assignment_id);
CREATE INDEX owner269_apply ON owner269_associations(apply_id,assignment_id);
CREATE INDEX owner269_consent ON owner269_operations(json_extract(event,'$.consentId'),json_extract(event,'$.receipt.action'));
CREATE TRIGGER owner269_operation_no_update BEFORE UPDATE ON owner269_operations
BEGIN SELECT RAISE(ABORT,'assignment_audit_immutable'); END;
CREATE TRIGGER owner269_operation_no_delete BEFORE DELETE ON owner269_operations
BEGIN SELECT RAISE(ABORT,'assignment_audit_immutable'); END;
CREATE TRIGGER owner269_association_no_delete BEFORE DELETE ON owner269_associations
BEGIN SELECT RAISE(ABORT,'assignment_audit_retained'); END;
CREATE TRIGGER owner269_association_transition BEFORE UPDATE ON owner269_associations
WHEN OLD.status IN ('rejected','revoked') OR NEW.assignment_id IS NOT OLD.assignment_id OR NEW.run_id IS NOT OLD.run_id
 OR NEW.recipient_account IS NOT OLD.recipient_account OR NEW.recipient_generation IS NOT OLD.recipient_generation
 OR NEW.apply_id IS NOT OLD.apply_id OR NEW.revision != OLD.revision+1 OR NEW.last_operation_id IS OLD.last_operation_id
BEGIN SELECT RAISE(ABORT,'assignment_conflict'); END;
`;
