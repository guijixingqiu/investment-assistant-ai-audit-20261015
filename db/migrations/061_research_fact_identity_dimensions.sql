-- Extend existing assertion uniqueness with economic scope/taxonomy; no row changes.
-- Distinct brand nodes in the same source page must not collide.
drop index research_fundamental_values_source_initial_identity_idx;
create unique index research_fundamental_values_source_initial_identity_idx on research_fundamental_values (
 candidate_membership_id, captured_membership_version, source_material_id, metric, period_kind,
 coalesce(period_start,period_end),period_end,currency,unit_scale,scope,
 coalesce(assertion_metadata->>'unit',''),coalesce(assertion_metadata->>'category',''),
 coalesce(assertion_metadata->>'businessScope',''),coalesce(assertion_metadata->>'measurementBasis',''),
 coalesce(assertion_metadata->'mix'->>'dimension',''),coalesce(assertion_metadata->'mix'->>'dimensionValue',''),
 coalesce(assertion_metadata->'mix'->>'parentNode',''),coalesce(assertion_metadata->'mix'->>'parentScope',''),
 coalesce(assertion_metadata->'mix'->>'overlapPolicy',''),coalesce(assertion_metadata->'guidance'->>'definition','')
) where replaces_value_id is null;
-- Narrowing back to the old index requires an explicit duplicate audit; never delete or coerce historical rows.
