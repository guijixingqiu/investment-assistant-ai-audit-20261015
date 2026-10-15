-- 054: explicit local OCR provenance for research documents.
--
-- Forward-only and additive. Existing rows keep their immutable page text and
-- page hashes; missing provenance defaults to "no OCR".

ALTER TABLE research_documents
  ADD COLUMN ocr_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN ocr_engine TEXT,
  ADD COLUMN ocr_engine_version TEXT,
  ADD COLUMN ocr_applied_at TIMESTAMPTZ,
  ADD COLUMN ocr_page_numbers INTEGER[] NOT NULL DEFAULT '{}';

ALTER TABLE research_documents
  ADD CONSTRAINT research_documents_ocr_status_check
  CHECK (ocr_status IN ('none', 'applied', 'unavailable'));

ALTER TABLE research_documents
  ADD CONSTRAINT research_documents_ocr_provenance_check
  CHECK (
    (ocr_status = 'applied'
      AND ocr_engine = 'apple_vision_pdfkit'
      AND ocr_engine_version IS NOT NULL
      AND ocr_applied_at IS NOT NULL
      AND cardinality(ocr_page_numbers) > 0)
    OR (ocr_status <> 'applied'
      AND ocr_engine IS NULL
      AND ocr_engine_version IS NULL
      AND ocr_applied_at IS NULL
      AND cardinality(ocr_page_numbers) = 0)
  );

ALTER TABLE research_document_pages
  ADD COLUMN ocr_applied BOOLEAN NOT NULL DEFAULT false;
