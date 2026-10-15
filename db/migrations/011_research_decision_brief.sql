alter table research_profiles
  add column if not exists key_variables text[] not null default '{}',
  add column if not exists catalysts text[] not null default '{}',
  add column if not exists evidence_gaps text[] not null default '{}';

alter table evidence_items
  add column if not exists materiality integer
    check (materiality is null or materiality between 1 and 5);
