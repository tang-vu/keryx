/** Fixed reference/migration SQL only. No constructor DDL. */
export const TOPIC_WATCHES_SQL = `CREATE TABLE IF NOT EXISTS topic_watches (
  wallet TEXT NOT NULL CHECK(wallet GLOB '0x*' AND length(wallet)=42 AND wallet=lower(wallet)),
  id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 64),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  state TEXT NOT NULL CHECK(length(CAST(state AS BLOB))<=262144 AND json_valid(state)),
  PRIMARY KEY(wallet,id)
);`;
