-- Additive vocabulary only; no historical values are rewritten.
-- Old readers continue to read old rows. New segment/unknown rows require the new contract.
-- Rollback must first verify that no new vocabulary rows exist; never coerce them to consolidated.
alter table research_fundamental_values drop constraint research_fundamental_values_scope_check;
alter table research_fundamental_values add constraint research_fundamental_values_scope_check
  check (scope in ('consolidated', 'parent_company', 'segment', 'unknown'));
