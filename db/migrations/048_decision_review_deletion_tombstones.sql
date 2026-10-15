alter table pre_trade_decision_checks
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_actor_id text;

alter table post_decision_reviews
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_actor_id text;

alter table pre_trade_decision_checks
  add constraint pre_trade_decision_checks_deletion_tombstone_check
  check (
    (deleted_at is null and deleted_by_actor_id is null)
    or (
      deleted_at is not null and length(trim(deleted_by_actor_id)) between 1 and 200
      and action_intent = 'deleted' and verdict = 'deleted'
      and requested_price is null and requested_quantity is null
      and current_price is null and current_quantity is null and average_cost is null
      and market_value is null and current_weight is null and user_final_decision is null
      and decided_at is null and raw_payload = '{"state":"deleted"}'::jsonb
      and decision_context_snapshot is null and decision_snapshot is null
    )
  );

alter table post_decision_reviews
  drop constraint if exists post_decision_reviews_outcome_check;

alter table post_decision_reviews
  add constraint post_decision_reviews_outcome_check
  check (outcome in ('thesis_confirmed', 'thesis_weakened', 'thesis_invalidated', 'insufficient_evidence', 'deleted'));

alter table post_decision_reviews
  add constraint post_decision_reviews_deletion_tombstone_check
  check (
    (deleted_at is null and deleted_by_actor_id is null)
    or (
      deleted_at is not null and length(trim(deleted_by_actor_id)) between 1 and 200
      and outcome = 'deleted' and outcome_evidence is null and review_note is null
      and raw_payload = '{"state":"deleted"}'::jsonb and portfolio_review_snapshot is null
    )
  );

create or replace function reject_decision_check_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and old.deleted_at is null and new.deleted_at is not null
     and new.id = old.id and new.stock_id = old.stock_id
     and new.market = old.market and new.code = old.code and new.symbol = old.symbol
     and new.checked_at = old.checked_at and new.created_at = old.created_at
  then return new;
  end if;
  raise exception 'decision checks are append-only except one-way Owner-confirmed body deletion';
end;
$$;

drop trigger if exists pre_trade_decision_checks_immutable on pre_trade_decision_checks;
create trigger pre_trade_decision_checks_immutable
before update or delete on pre_trade_decision_checks
for each row execute function reject_decision_check_mutation();

create or replace function reject_post_decision_review_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and old.deleted_at is null and new.deleted_at is not null
     and new.id = old.id and new.decision_check_id = old.decision_check_id
     and new.actor_type = old.actor_type and new.actor_id is not distinct from old.actor_id
     and new.reviewed_at = old.reviewed_at and new.created_at = old.created_at
     and new.idempotency_key = old.idempotency_key
  then return new;
  end if;
  raise exception 'post-decision reviews are append-only except one-way Owner-confirmed body deletion';
end;
$$;

drop trigger if exists post_decision_reviews_immutable on post_decision_reviews;
create trigger post_decision_reviews_immutable
before update or delete on post_decision_reviews
for each row execute function reject_post_decision_review_mutation();

alter table research_write_audit_events
  drop constraint if exists research_write_audit_events_event_type_check;

alter table research_write_audit_events
  add constraint research_write_audit_events_event_type_check
  check (event_type in (
    'profile_updated', 'evidence_created', 'decision_check_created', 'decision_check_deleted',
    'post_decision_review_created', 'post_decision_review_deleted',
    'research_material_created', 'research_material_deleted', 'research_document_imported',
    'research_fundamental_value_created', 'research_valuation_scenario_created',
    'evidence_pack_frozen', 'deep_research_task_enqueued', 'deep_research_task_canceled',
    'deep_research_report_created', 'deep_research_report_decided', 'deep_research_report_deleted',
    'research_event_created', 'geely_sales_monitor_created', 'gcl_pv_price_monitor_created',
    'research_evidence_question_attempted', 'research_evidence_question_answered',
    'today_material_change_dispositioned'
  ));

alter table research_write_audit_events
  drop constraint if exists research_write_audit_events_candidate_binding_check;

alter table research_write_audit_events
  add constraint research_write_audit_events_candidate_binding_check
  check (
    event_type not in (
      'profile_updated', 'evidence_created',
      'research_material_created', 'research_material_deleted', 'research_document_imported',
      'research_fundamental_value_created', 'research_valuation_scenario_created',
      'evidence_pack_frozen', 'deep_research_task_enqueued', 'deep_research_task_canceled',
      'deep_research_report_created', 'deep_research_report_decided', 'deep_research_report_deleted',
      'research_event_created', 'geely_sales_monitor_created', 'gcl_pv_price_monitor_created',
      'research_evidence_question_attempted', 'research_evidence_question_answered',
      'today_material_change_dispositioned'
    )
    or (
      request_fingerprint is not null and candidate_membership_id is not null
      and candidate_membership_version is not null and candidate_membership_version > 0
    )
  ) not valid;

comment on column pre_trade_decision_checks.deleted_at is
  'Owner-confirmed formal decision body deletion; minimal identity remains as a contentless tombstone.';
comment on column post_decision_reviews.deleted_at is
  'Owner-confirmed review body deletion; minimal identity remains as a contentless tombstone.';
