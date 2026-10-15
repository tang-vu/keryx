/** DATA ONLY, UNINSTALLED. Installing triggers on occupied #262/original
 * relations needs the explicit additional partition in the handoff. */
export const OWNER269_OCCUPANCY_PROPOSAL = Object.freeze([
  { name: "owner269_ticket_occupancy", sql: `CREATE TRIGGER owner269_ticket_occupancy BEFORE INSERT ON anonymous_run_claims
WHEN EXISTS(SELECT 1 FROM owner269_associations WHERE run_id=NEW.run_id AND status IN ('assigned-by-owner','claimed'))
BEGIN SELECT RAISE(ABORT,'claim_unavailable'); END` },
  ...(["INSERT", "UPDATE", "DELETE"] as const).map(operation => ({ name: `owner269_original_${operation.toLowerCase()}`,
    sql: `CREATE TRIGGER owner269_original_${operation.toLowerCase()} BEFORE ${operation} ON query_runs
WHEN EXISTS(SELECT 1 FROM owner269_associations WHERE run_id=${operation === "INSERT" ? "NEW" : "OLD"}.id AND status IN ('assigned-by-owner','claimed'))
BEGIN SELECT RAISE(ABORT,'assignment_original_occupied'); END` })),
  ...(["INSERT", "UPDATE"] as const).map(operation => ({ name: `owner269_a2a_${operation.toLowerCase()}`,
    sql: `CREATE TRIGGER owner269_a2a_${operation.toLowerCase()} BEFORE ${operation} ON a2a_orders
WHEN EXISTS(SELECT 1 FROM owner269_associations WHERE run_id=NEW.query_id AND status IN ('assigned-by-owner','claimed'))
BEGIN SELECT RAISE(ABORT,'assignment_original_occupied'); END` })),
]);
