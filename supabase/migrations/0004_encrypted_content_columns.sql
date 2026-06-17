-- Migration 0004: IPFS encrypted content columns on source_items.
--
-- These columns store the AES-256-GCM envelope for each content item when the
-- IPFS path is active (PINATA_JWT + CONTENT_MASTER_KEY set). When NULL the item
-- falls back to plaintext DB content — preserving offline dev behavior.
--
-- ipfs_cid:      CID of the encrypted blob on Pinata public IPFS
-- item_key_enc:  base64 per-item AES key wrapped with CONTENT_MASTER_KEY (+ GCM tag)
-- item_iv:       base64 12-byte GCM nonce for the content ciphertext
-- item_auth_tag: base64 16-byte GCM auth tag for the content ciphertext

do $$ begin
  alter table public.source_items add column ipfs_cid text;
exception when duplicate_column then null;
end $$;

do $$ begin
  alter table public.source_items add column item_key_enc text;
exception when duplicate_column then null;
end $$;

do $$ begin
  alter table public.source_items add column item_iv text;
exception when duplicate_column then null;
end $$;

do $$ begin
  alter table public.source_items add column item_auth_tag text;
exception when duplicate_column then null;
end $$;
