import { expect, it } from "vitest";
import { postgresBrowserMigrationProfiles } from "../../test-support/postgres-browser-migration-profiles";
const accepted = ["0067_browser_authorization_admission.sql", "0068_browser_authorization_timestamp.sql", "0069_browser_authorization_journal.sql", "0073_enrolled_storage_substrate.sql", "0074_enrolled_storage_domain_apis.sql", "0075_enrolled_storage_domain_wrappers.sql", "0076_enrolled_storage_owner_cutover.sql", "0077_session_revoke_generation.sql", "0078_research_monthly.sql", "0079_synthetic_evidence_provenance.sql", "0085_profile_verified_identities.sql"];
it("preserves all supplied accepted native inputs and isolates explicit ordinary-only extensions", () => {
  const files = [...accepted, "0086_decision_reviews.sql", "0087_deliverable_acceptance.sql"];
  const profiles = postgresBrowserMigrationProfiles(files);
  expect(profiles.native).toEqual([...accepted].sort());
  expect(profiles.ordinary).toEqual(accepted.filter(file => Number(file.slice(0, 4)) < 73 || file === "0078_research_monthly.sql").sort());
  expect(profiles.extensions).toEqual([{ file: "0086_decision_reviews.sql", refusal: "review_unavailable" }, { file: "0087_deliverable_acceptance.sql", refusal: "acceptance_unavailable" }]);
});
it("refuses a new unclassified migration rather than silently omit or install it", () => {
  expect(() => postgresBrowserMigrationProfiles([...accepted, "0088_future_domain.sql"])).toThrow("Unreviewed migration profile");
});
it("refuses missing accepted native coverage and duplicate identities", () => {
  expect(() => postgresBrowserMigrationProfiles(accepted.filter(file => !file.startsWith("0074")))).toThrow("missing");
  expect(() => postgresBrowserMigrationProfiles([...accepted, accepted[0]])).toThrow("Duplicate migration");
});
