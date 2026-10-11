import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { postgresBrowserMigrationProfiles } from "../../test-support/postgres-browser-migration-profiles";
const accepted = ["0067_browser_authorization_admission.sql", "0068_browser_authorization_timestamp.sql", "0069_browser_authorization_journal.sql", "0073_enrolled_storage_substrate.sql", "0074_enrolled_storage_domain_apis.sql", "0075_enrolled_storage_domain_wrappers.sql", "0076_enrolled_storage_owner_cutover.sql", "0077_session_revoke_generation.sql", "0078_research_monthly.sql", "0079_synthetic_evidence_provenance.sql", "0085_profile_verified_identities.sql"];
it("preserves all supplied accepted native inputs and isolates explicit ordinary-only extensions", () => {
  const files = [...accepted, "0086_decision_reviews.sql", "0087_deliverable_acceptance.sql", "0088_anonymous_run_claims.sql", "0089_public_usage_window.sql"];
  const profiles = postgresBrowserMigrationProfiles(files);
  expect(profiles.native).toEqual([...accepted].sort());
  expect(profiles.ordinary).toEqual(accepted.filter(file => Number(file.slice(0, 4)) < 73 || file === "0078_research_monthly.sql").sort());
  expect(profiles.extensions).toEqual([{ file: "0086_decision_reviews.sql", refusal: "review_unavailable" },
    { file: "0087_deliverable_acceptance.sql", refusal: "acceptance_unavailable" },
    { file: "0088_anonymous_run_claims.sql", refusal: "claims_unavailable" }, { file: "0089_public_usage_window.sql", refusal: "usage_unavailable" }]);
  const ordinaryInstall = profiles.ordinary.concat(profiles.extensions.map(extension => extension.file));
  for (const file of ["0088_anonymous_run_claims.sql", "0089_public_usage_window.sql"]) {
    expect(ordinaryInstall.filter(item => item === file)).toHaveLength(1);
    expect(profiles.native).not.toContain(file);
  }
});
it("binds 0088's native refusal and invocation before its first ordinary table", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/0088_anonymous_run_claims.sql", import.meta.url), "utf8");
  const extension = postgresBrowserMigrationProfiles([...accepted, "0088_anonymous_run_claims.sql"]).extensions[0];
  expect(extension).toEqual({ file: "0088_anonymous_run_claims.sql", refusal: "claims_unavailable" });
  const create = sql.indexOf("create table public.anonymous_run_claims");
  expect(create).toBeGreaterThan(0);
  const preInstall = sql.slice(0, create);
  expect(preInstall).toContain("to_regclass('public.keryx_storage_identity') is not null");
  expect(preInstall).toContain("to_regclass('keryx_storage.identity') is not null");
  expect(preInstall).toContain(`raise exception '${extension.refusal}'`);
  expect(preInstall).toContain("select public.anonymous_run_claims_ordinary_v1();");
});
it("binds 0089's native refusal to its actual pre-install guard before the ordinary function", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/0089_public_usage_window.sql", import.meta.url), "utf8");
  const profile = postgresBrowserMigrationProfiles([...accepted, "0089_public_usage_window.sql"]);
  const extension = profile.extensions[0];
  expect(extension).toEqual({ file: "0089_public_usage_window.sql", refusal: "usage_unavailable" });
  const create = sql.indexOf("create or replace function public.public_usage_window_v1");
  expect(create).toBeGreaterThan(0);
  const preInstall = sql.slice(0, create);
  expect(preInstall).toContain("to_regclass('public.keryx_storage_identity') is not null");
  expect(preInstall).toContain("to_regclass('keryx_storage.identity') is not null");
  expect(preInstall).toContain(`raise exception '${extension.refusal}'`);
});
it("refuses a new unclassified migration rather than silently omit or install it", () => {
  expect(() => postgresBrowserMigrationProfiles([...accepted, "0088_future_domain.sql"])).toThrow("Unreviewed migration profile");
  expect(() => postgresBrowserMigrationProfiles([...accepted, "0089_unknown_usage.sql"])).toThrow("Unreviewed migration profile");
  expect(() => postgresBrowserMigrationProfiles([...accepted, "0090_future_domain.sql"])).toThrow("Unreviewed migration profile");
});
it("refuses missing accepted native coverage and duplicate identities", () => {
  expect(() => postgresBrowserMigrationProfiles(accepted.filter(file => !file.startsWith("0074")))).toThrow("missing");
  expect(() => postgresBrowserMigrationProfiles([...accepted, accepted[0]])).toThrow("Duplicate migration");
});
