-- A reviewed correction may be disclosed in a different document. Membership binding remains mandatory.
-- The API enforces canonical economic identity before linking a successor. Existing rows remain unchanged.
alter table research_fundamental_values drop constraint research_fundamental_values_replacement_chain_fk;
alter table research_fundamental_values add constraint research_fundamental_values_replacement_chain_fk
 foreign key (replaces_value_id,candidate_membership_id)
 references research_fundamental_values(id,candidate_membership_id) on delete restrict;
-- Reverting to same-source FK is only possible if no cross-source successor has been written.
