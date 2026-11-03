// Dedicated public-only catalog. Content lives in private, content-addressed R2 objects.
export const CATALOG_IDENTITY = "keryx-public-catalog-v1";
export const CATALOG_SQL = `
CREATE TABLE catalog_control (
 generation TEXT PRIMARY KEY, identity TEXT NOT NULL CHECK(identity='keryx-public-catalog-v1'),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 0 AND 9007199254740991),
 ready INTEGER NOT NULL CHECK(ready IN (0,1))
);
CREATE TRIGGER catalog_identity_immutable BEFORE UPDATE OF generation,identity ON catalog_control
 BEGIN SELECT RAISE(ABORT,'catalog identity immutable'); END;
CREATE TRIGGER catalog_identity_retained BEFORE DELETE ON catalog_control
 BEGIN SELECT RAISE(ABORT,'catalog identity retained'); END;
CREATE TABLE public_references (
 generation TEXT NOT NULL REFERENCES catalog_control(generation), id TEXT NOT NULL,
 active INTEGER NOT NULL CHECK(active IN (0,1)), rss_url TEXT NOT NULL, snapshot_key TEXT NOT NULL,
 PRIMARY KEY(generation,id)
);
CREATE TABLE public_reference_article_versions (
 generation TEXT NOT NULL, reference_id TEXT NOT NULL, item_id TEXT NOT NULL, revision TEXT NOT NULL,
 content_version TEXT NOT NULL, snapshot_key TEXT NOT NULL, original_key TEXT NOT NULL,
 collection_kind TEXT NOT NULL CHECK(collection_kind IN ('feed','article')), collected_at TEXT NOT NULL,
 PRIMARY KEY(generation,reference_id,item_id,revision),
 FOREIGN KEY(generation) REFERENCES catalog_control(generation)
);
CREATE TRIGGER public_reference_versions_immutable BEFORE UPDATE ON public_reference_article_versions
 BEGIN SELECT RAISE(ABORT,'public article version immutable'); END;
CREATE TRIGGER public_reference_versions_retained BEFORE DELETE ON public_reference_article_versions
 BEGIN SELECT RAISE(ABORT,'public article version retained'); END;
CREATE TRIGGER public_reference_versions_no_conflict BEFORE INSERT ON public_reference_article_versions
 WHEN EXISTS(SELECT 1 FROM public_reference_article_versions v WHERE v.generation=NEW.generation
 AND v.reference_id=NEW.reference_id AND v.item_id=NEW.item_id AND v.revision=NEW.revision
 AND (v.content_version IS NOT NEW.content_version OR v.snapshot_key IS NOT NEW.snapshot_key
 OR v.original_key IS NOT NEW.original_key OR v.collection_kind IS NOT NEW.collection_kind))
 BEGIN SELECT RAISE(ABORT,'public article version conflict'); END;
CREATE TABLE catalog_index_revisions (
 generation TEXT NOT NULL REFERENCES catalog_control(generation), reference_id TEXT NOT NULL,
 item_id TEXT NOT NULL, revision TEXT NOT NULL, algorithm TEXT NOT NULL CHECK(algorithm='literal-weights-nfkc-v1'),
 terms_count INTEGER NOT NULL CHECK(typeof(terms_count)='integer' AND terms_count BETWEEN 0 AND 500000),
 terms_digest TEXT NOT NULL, complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0,1)),
 PRIMARY KEY(generation,reference_id,item_id,revision), UNIQUE(generation,reference_id,item_id,revision,complete)
);
CREATE TRIGGER catalog_index_immutable BEFORE UPDATE ON catalog_index_revisions WHEN OLD.complete=1
 BEGIN SELECT RAISE(ABORT,'complete public index immutable'); END;
CREATE TRIGGER catalog_index_retained BEFORE DELETE ON catalog_index_revisions
 BEGIN SELECT RAISE(ABORT,'public index retained'); END;
CREATE TABLE public_reference_articles (
 generation TEXT NOT NULL, reference_id TEXT NOT NULL, item_id TEXT NOT NULL, canonical_url TEXT NOT NULL,
 current_revision TEXT NOT NULL, first_collected_at TEXT NOT NULL, last_collected_at TEXT NOT NULL,
 published_at TEXT, sort_at TEXT NOT NULL, index_complete INTEGER NOT NULL DEFAULT 1 CHECK(index_complete=1),
 PRIMARY KEY(generation,reference_id,item_id),
 UNIQUE(generation,reference_id,canonical_url),
 FOREIGN KEY(generation,reference_id,item_id,current_revision)
 REFERENCES public_reference_article_versions(generation,reference_id,item_id,revision),
 FOREIGN KEY(generation,reference_id,item_id,current_revision,index_complete)
 REFERENCES catalog_index_revisions(generation,reference_id,item_id,revision,complete)
);
CREATE INDEX public_reference_articles_recent ON public_reference_articles(generation,(published_at IS NOT NULL) DESC,sort_at DESC,reference_id,item_id);
CREATE INDEX public_reference_articles_oldest ON public_reference_articles(generation,(published_at IS NOT NULL) DESC,sort_at ASC,reference_id,item_id);
CREATE INDEX public_reference_articles_publisher ON public_reference_articles(generation,reference_id,(published_at IS NOT NULL) DESC,sort_at DESC,item_id);
CREATE INDEX public_reference_articles_publisher_oldest ON public_reference_articles(generation,reference_id,(published_at IS NOT NULL) DESC,sort_at ASC,item_id);
CREATE TABLE public_reference_article_terms (
 generation TEXT NOT NULL, term TEXT NOT NULL, reference_id TEXT NOT NULL, item_id TEXT NOT NULL, revision TEXT NOT NULL,
 weight INTEGER NOT NULL CHECK(typeof(weight)='integer' AND weight BETWEEN 1 AND 9),
 PRIMARY KEY(generation,term,reference_id,item_id,revision),
 FOREIGN KEY(generation,reference_id,item_id,revision) REFERENCES catalog_index_revisions(generation,reference_id,item_id,revision)
);
CREATE INDEX public_reference_article_terms_item ON public_reference_article_terms(generation,reference_id,item_id,revision);
CREATE TRIGGER catalog_terms_no_insert BEFORE INSERT ON public_reference_article_terms
 WHEN EXISTS(SELECT 1 FROM catalog_index_revisions i WHERE i.generation=NEW.generation AND i.reference_id=NEW.reference_id
 AND i.item_id=NEW.item_id AND i.revision=NEW.revision AND i.complete=1)
 BEGIN SELECT RAISE(ABORT,'complete public index immutable'); END;
CREATE TRIGGER catalog_terms_no_update BEFORE UPDATE ON public_reference_article_terms
 BEGIN SELECT RAISE(ABORT,'public index term immutable'); END;
CREATE TRIGGER catalog_terms_no_delete BEFORE DELETE ON public_reference_article_terms
 BEGIN SELECT RAISE(ABORT,'public index term retained'); END;
CREATE TRIGGER catalog_terms_no_conflict BEFORE INSERT ON public_reference_article_terms
 WHEN EXISTS(SELECT 1 FROM public_reference_article_terms t WHERE t.generation=NEW.generation AND t.term=NEW.term
 AND t.reference_id=NEW.reference_id AND t.item_id=NEW.item_id AND t.revision=NEW.revision AND t.weight IS NOT NEW.weight)
 BEGIN SELECT RAISE(ABORT,'public index term conflict'); END;
`;
