-- Fresh SOURCE-only indexes for the additional current application tables.
SET ROLE keryx_owner;

-- SQLite INDEX account267_challenges_account sha256:e56f476cbf2cade5b996902603b739c610c85267f0a89aa734ed985dcbc531e1
CREATE INDEX account267_challenges_account ON public.account267_challenges((payload::jsonb #>> '{accountId}'),consumed_at,nonce_hash);

-- SQLite INDEX account267_challenges_session sha256:0afc0bd4e022af2eda92127e4d261acffffa5d1b684aa4bd6f5e1c6b5a204162
CREATE INDEX account267_challenges_session ON public.account267_challenges(session_hash,consumed_at,expires_at);

-- SQLite INDEX account267_credentials_account sha256:e79f3e93b006af35efb74e6ea42f76fffc0ee2acf7322bc74692662fcb4ac1d4
CREATE INDEX account267_credentials_account ON public.account267_credentials(account_id,wallet);

-- SQLite INDEX account267_events_account sha256:b5cb18defd78eac71c83be4ba87ee55605a2141766ad121edef49d811d0f9a27
CREATE INDEX account267_events_account ON public.account267_events(account_id,revision);

-- SQLite INDEX account267_members_account sha256:087c8b35e00c50cda226624a5addcba1c8483aa52361f8a3820e8ffb209e8d47
CREATE INDEX account267_members_account ON public.account267_members(account_id,wallet);

-- SQLite INDEX account267_sessions_account sha256:8bc76d86ac3945172c4c0131ea017c4119649c7aaf98bc96b5ff0e53810da4f3
CREATE INDEX account267_sessions_account ON public.account267_sessions(account_id,wallet,revoked_at,expires_at,session_hash);

-- SQLite INDEX account267_sessions_live sha256:8796d2c28a87e26d6947ebabdf6f446d3303b011b47ad8d4e4364c4ebf9d73b8
CREATE INDEX account267_sessions_live ON public.account267_sessions(account_id,revoked_at,expires_at,session_hash);

-- SQLite INDEX anonymous_run_claims_owner sha256:32a10a388c762858dd4a4645a761711c28a61a8ffddcb3fa6552683bf41cb5ea
CREATE INDEX anonymous_run_claims_owner ON public.anonymous_run_claims(claimed_wallet,run_id);

-- SQLite INDEX chat263_links_account sha256:a89a8aafa70a8d75a27b04c3fb971d3d0971f6504fd4760a820477fe7f957c21
CREATE INDEX chat263_links_account ON public.chat263_links(account_id,origin,network,platform,scope,user_id);

-- SQLite INDEX chat263_tokens_recipient sha256:cbba397df6791fd2f6d619cdf4ba0568b3396f0f70cda4268724b64db76f714b
CREATE INDEX chat263_tokens_recipient ON public.chat263_tokens(platform,scope,user_id,origin,network,expires_at);

-- SQLite INDEX decision_review_owner_run sha256:a3856952a6b14f8537d0973b09e5295fb4f06a9a1684e3acb5f87cf8c6b3f6b2
CREATE INDEX decision_review_owner_run ON public.decision_review_records(wallet,run_id,created_at,id);

-- SQLite INDEX decision_review_period sha256:9ca40ff641c83d37b60c5a8af0efcd23201f31438e2dca34e6f7001ef1dcb3f5
CREATE INDEX decision_review_period ON public.decision_review_records(network,created_at);

-- SQLite INDEX owner269_apply sha256:0723a10eb17bca73156991216e61c0c7846f4ae0923d4a76d0fb3fbe317e1698
CREATE INDEX owner269_apply ON public.owner269_associations(apply_id,assignment_id);

-- SQLite INDEX owner269_consent sha256:8e61f6c3ac43ad650002521685fe8629ca5bba6d42c55253f3390d2bd83d0abe
CREATE INDEX owner269_consent ON public.owner269_operations((event::jsonb #>> '{consentId}'),(event::jsonb #>> '{receipt,action}'));

-- SQLite INDEX owner269_occupancy sha256:38ac738c27344f4b916540dc66393b6ce2cc934ee89bdb609cb2e6ddfca3f098
CREATE UNIQUE INDEX owner269_occupancy ON public.owner269_associations(run_id) WHERE status IN ('assigned-by-owner','claimed');

-- SQLite INDEX owner269_recipient sha256:c61c2c98a632dc7ab732275d0c6800033fc82dd220cd74202214eb783fba0dd3
CREATE INDEX owner269_recipient ON public.owner269_associations(recipient_account,recipient_generation,status,assignment_id);

-- SQLite INDEX pending_job_owners_wallet sha256:01896bfc3cc6793a2325e5d2839fcc4aef5cd1f4a31923616eac83bb1dcfe511
CREATE INDEX pending_job_owners_wallet ON public.pending_job_owners(wallet,admitted_at,job_id);

-- SQLite INDEX public_reference_article_terms_item sha256:b0b5eb9144a3ca95bba81668e4014a6069204b3b02f5736bae05b9c5913fc136
CREATE INDEX public_reference_article_terms_item ON public.public_reference_article_terms(reference_id,item_id);

-- SQLite INDEX public_reference_articles_oldest sha256:fcaf44fed9f9f595cc69bef2f932b5d3da209297744e051c38395eddd69ecfbc
CREATE INDEX public_reference_articles_oldest ON public.public_reference_articles((published_at IS NOT NULL) DESC,sort_at ASC,reference_id,item_id);

-- SQLite INDEX public_reference_articles_publisher sha256:6022f88621a6eecc4222571b2cf75f894101cc64bda827d1c7aa8691c21ed70c
CREATE INDEX public_reference_articles_publisher ON public.public_reference_articles(reference_id,(published_at IS NOT NULL) DESC,sort_at DESC,item_id);

-- SQLite INDEX public_reference_articles_publisher_oldest sha256:a62130435b3032f17fcc732696c3c8a4b1de7890e6d1b8568775e421e7be0eaa
CREATE INDEX public_reference_articles_publisher_oldest ON public.public_reference_articles(reference_id,(published_at IS NOT NULL) DESC,sort_at ASC,item_id);

-- SQLite INDEX public_reference_articles_recent sha256:f55aa0adc47b3c36ee90cd0b160bddf73e1dbd6519569be71729a5139fd910b4
CREATE INDEX public_reference_articles_recent ON public.public_reference_articles((published_at IS NOT NULL) DESC,sort_at DESC,reference_id,item_id);

RESET ROLE;
