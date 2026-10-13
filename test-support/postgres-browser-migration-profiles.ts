import assert from "node:assert/strict";

/** Complete previously accepted chain, including dormant native substrate/wrappers, remains intact. */
export const ORDINARY_BROWSER_FIXTURE_EXTENSIONS = Object.freeze({
  "0086_decision_reviews.sql": "review_unavailable",
  "0087_deliverable_acceptance.sql": "acceptance_unavailable",
  "0088_anonymous_run_claims.sql": "claims_unavailable",
  "0089_public_usage_window.sql": "usage_unavailable",
  "0090_run_privacy.sql": "privacy_unavailable",
  // Native storage refused0090, so its ordinary guard is absent before0091.
  "0091_public_researcher_profiles.sql": "run_privacy_guard_v1\\(\\) does not exist",
});
export function postgresBrowserMigrationProfiles(files: readonly string[]) {
  const migrations = files.filter(file => /^\d{4}.*\.sql$/.test(file)).sort();
  assert.equal(new Set(migrations).size, migrations.length, "Duplicate migration identity");
  const extensions: Array<{ file: string; refusal: string }> = [];
  for (const file of migrations.filter(file => Number(file.slice(0, 4)) > 85)) {
    assert(Object.hasOwn(ORDINARY_BROWSER_FIXTURE_EXTENSIONS, file), `Unreviewed migration profile: ${file}`);
    extensions.push({ file, refusal: ORDINARY_BROWSER_FIXTURE_EXTENSIONS[file as keyof typeof ORDINARY_BROWSER_FIXTURE_EXTENSIONS] });
  }
  const native = migrations.filter(file => Number(file.slice(0, 4)) <= 85);
  for (const name of ["0067_browser_authorization_admission.sql", "0068_browser_authorization_timestamp.sql", "0069_browser_authorization_journal.sql", "0073_enrolled_storage_substrate.sql", "0074_enrolled_storage_domain_apis.sql", "0075_enrolled_storage_domain_wrappers.sql", "0076_enrolled_storage_owner_cutover.sql", "0085_profile_verified_identities.sql"])
    assert(native.includes(name), `Accepted browser/native migration missing: ${name}`);
  // Exact ordinary prerequisites: historical app tables, prepaid purchase claims,
  // and the source-known private-profile/identity domains required by0091.
  // Install these BEFORE0088/0090 seal their ordinary catalog.
  // 0077/0079 and their generated catalogs require the native substrate; they are not an ordinary profile.
  const ordinary = native.filter(file => Number(file.slice(0, 4)) < 73 ||
    ["0078_research_monthly.sql", "0083_private_profiles.sql", "0085_profile_verified_identities.sql"].includes(file));
  return { native, ordinary, extensions };
}
