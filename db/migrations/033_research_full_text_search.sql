create index if not exists research_documents_search_fts_idx
  on research_documents using gin (
    to_tsvector('simple'::regconfig, title || ' ' || original_filename || ' ' || source_version)
  );

create index if not exists research_document_pages_search_fts_idx
  on research_document_pages using gin (
    to_tsvector('simple'::regconfig, normalized_text)
  );

create index if not exists research_materials_search_fts_idx
  on research_materials using gin (
    to_tsvector('simple'::regconfig, title || ' ' || content_text || ' ' || source_version)
  );
