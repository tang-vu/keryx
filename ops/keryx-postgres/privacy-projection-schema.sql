SET ROLE keryx_owner;
CREATE TABLE keryx_storage.run_privacy_projection(
 run_id text PRIMARY KEY REFERENCES public.query_runs(id) ON DELETE CASCADE,
 original_sha256 text NOT NULL CHECK(original_sha256 ~ '^[a-f0-9]{64}$'),
 data_bytes integer NOT NULL CHECK(data_bytes BETWEEN 0 AND 4000000),original_valid boolean NOT NULL,
 scalar_identity_sha256 text NOT NULL CHECK(scalar_identity_sha256 ~ '^[a-f0-9]{64}$'),
 scalar_cells jsonb NOT NULL CHECK(jsonb_typeof(scalar_cells)='object' AND octet_length(scalar_cells::text)<=8388608),
 -- Answer is independently toastable and never selected by metadata readers.
 answer_scalar bytea CHECK(octet_length(answer_scalar)<=4000000),
 erase_wire text CHECK(octet_length(erase_wire)<=4000000),original_fulfillment boolean NOT NULL,
 question_fields text CHECK(octet_length(question_fields)<=8000000),
 history_fields text CHECK(octet_length(history_fields)<=8000000),
 history_references jsonb NOT NULL CHECK(jsonb_typeof(history_references)='array' AND jsonb_array_length(history_references)<=10000 AND octet_length(history_references::text)<=4194304),
 learning_fields text CHECK(octet_length(learning_fields)<=8000000),
 profile_fields text CHECK(octet_length(profile_fields)<=262144),
 payment_offline boolean,funding_offline boolean,funding_treasury boolean,
 archive_wire text CHECK(octet_length(archive_wire)<=2097152),
 erase_projection jsonb CHECK(erase_projection IS NULL OR octet_length(erase_projection::text)<=16777216)
);
REVOKE ALL ON keryx_storage.run_privacy_projection FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
