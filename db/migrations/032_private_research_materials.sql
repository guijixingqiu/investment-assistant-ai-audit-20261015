alter table research_materials
  drop constraint if exists research_materials_citation_all_or_none_check;

alter table research_materials
  add constraint research_materials_citation_all_or_none_check
  check (
    (
      citation_document_id is null
      and citation_page_number is null
      and citation_page_text_sha256 is null
    )
    or
    (
      candidate_membership_id is not null
      and citation_document_id is not null
      and citation_page_number is not null
      and citation_page_number > 0
      and citation_page_text_sha256 ~ '^[a-f0-9]{64}$'
    )
  );
