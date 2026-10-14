import { RESERVED_PROFILE_HANDLES } from "../profiles/private-profile";

export const PRIVATE_PROFILES_SQL = `CREATE TABLE IF NOT EXISTS private_profiles (
  wallet TEXT PRIMARY KEY CHECK(length(wallet)=42 AND wallet=lower(wallet) AND substr(wallet,1,2)='0x' AND substr(wallet,3) NOT GLOB '*[^0-9a-f]*'),
  handle TEXT UNIQUE CHECK(handle IS NULL OR (length(handle) BETWEEN 3 AND 32 AND handle=lower(handle) AND substr(handle,1,1) GLOB '[a-z]' AND handle NOT GLOB '*[^a-z0-9_]*' AND handle NOT IN (${RESERVED_PROFILE_HANDLES.map(value => `'${value}'`).join(",")}))),
  display_name TEXT NOT NULL CHECK(length(display_name)<=80), bio TEXT NOT NULL CHECK(length(bio)<=160), purpose TEXT NOT NULL CHECK(length(purpose)<=160),
  links TEXT NOT NULL CHECK(json_valid(links) AND json_type(links)='array' AND json_array_length(links)<=6),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);`;

export const PROFILE_IDENTITIES_SQL = `CREATE TABLE IF NOT EXISTS profile_verified_identities (
  wallet TEXT NOT NULL REFERENCES private_profiles(wallet) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('orcid','github')),
  external_id TEXT, label TEXT, verified_at TEXT,
  current_state_hash TEXT CHECK(current_state_hash IS NULL OR (length(current_state_hash)=64 AND current_state_hash NOT GLOB '*[^0-9a-f]*')),
  PRIMARY KEY(wallet,provider), UNIQUE(provider,external_id),
  CHECK((external_id IS NULL AND label IS NULL AND verified_at IS NULL) OR
    (external_id IS NOT NULL AND length(external_id) BETWEEN 1 AND 32 AND label IS NOT NULL AND length(label)<=160 AND verified_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS profile_identity_challenges (
  state_hash TEXT PRIMARY KEY CHECK(length(state_hash)=64 AND state_hash NOT GLOB '*[^0-9a-f]*'),
  wallet TEXT NOT NULL, provider TEXT NOT NULL,
  session_hash TEXT NOT NULL CHECK(length(session_hash)=64 AND session_hash NOT GLOB '*[^0-9a-f]*'),
  expires_at INTEGER NOT NULL CHECK(expires_at>=0),
  status TEXT NOT NULL CHECK(status IN ('pending','consumed')),
  UNIQUE(wallet,provider),
  FOREIGN KEY(wallet,provider) REFERENCES profile_verified_identities(wallet,provider) ON DELETE CASCADE
);`;
