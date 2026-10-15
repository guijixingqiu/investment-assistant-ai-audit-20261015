-- NULL preserves every pre-selection full or limited pack's original all-material semantics.
-- New limited packs persist their explicit scope without changing historical rows.
alter table research_evidence_packs
  add column material_selection_mode text null,
  add constraint research_evidence_packs_material_selection_mode_check
    check (material_selection_mode is null
      or (research_mode = 'limited' and material_selection_mode = 'explicit'));

comment on column research_evidence_packs.material_selection_mode is
  'NULL means legacy freeze semantics; explicit means this limited pack contains exactly the Owner-selected materials.';
