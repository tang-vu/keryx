/** Data only: safe for the identity inventory without schema/module cycles. */
export const NATIVE_USER_DOMAIN_TABLES = Object.freeze([
  "private_profiles", "profile_verified_identities", "profile_identity_challenges",
  "private_bibliographies", "deliverable_acceptance_store", "deliverable_acceptance_entries",
  "run_privacy", "run_privacy_defaults", "run_privacy_audit", "anonymous_run_claims",
  "public_researcher_profiles", "decision_review_records", "decision_review_verdicts",
  "account267_accounts", "account267_members", "account267_credentials",
  "account267_sessions", "account267_challenges", "account267_events",
  "topic_watches",
  "chat263_links", "chat263_tokens",
  "owner269_operations", "owner269_associations",
] as const);
