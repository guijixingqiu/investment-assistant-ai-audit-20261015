alter table deep_research_tasks
  add column previous_task_id bigint references deep_research_tasks(id) on delete restrict;

alter table deep_research_tasks
  add constraint deep_research_tasks_previous_task_check
  check (previous_task_id is null or previous_task_id <> id);

alter table deep_research_tasks
  drop constraint deep_research_tasks_candidate_membership_id_candidate_membe_key;

create unique index deep_research_tasks_run_identity_idx
  on deep_research_tasks (
    candidate_membership_id,
    candidate_membership_version,
    evidence_pack_id,
    request_fingerprint,
    actor_type,
    actor_id,
    coalesce(previous_task_id, 0)
  );
