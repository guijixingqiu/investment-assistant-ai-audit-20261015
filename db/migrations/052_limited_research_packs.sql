alter table research_evidence_packs
  add column research_mode text not null default 'full'
  check (research_mode in ('full', 'limited')),
  add constraint research_evidence_packs_limited_context_check
  check (research_mode <> 'limited' or frozen_research_context is null);
