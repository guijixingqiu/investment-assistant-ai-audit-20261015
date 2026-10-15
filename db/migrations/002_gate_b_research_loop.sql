create table if not exists research_profiles (
  id bigserial primary key,
  stock_id bigint not null references stocks(id),
  market text not null,
  code text not null,
  symbol text not null,
  current_view text not null,
  current_thesis text not null,
  market_disagreement text,
  invalidation_condition text,
  next_review_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stock_id)
);

create table if not exists evidence_items (
  id bigserial primary key,
  research_profile_id bigint not null references research_profiles(id),
  source_type text not null,
  source_url text,
  published_at timestamptz,
  captured_at timestamptz not null default now(),
  summary text not null,
  fact_kind text not null check (fact_kind in ('fact', 'inference')),
  variable_name text,
  stance text not null check (stance in ('support', 'refute', 'neutral')),
  reliability integer check (reliability is null or (reliability between 1 and 5)),
  is_read boolean not null default false,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists evidence_items_profile_created_idx
  on evidence_items (research_profile_id, created_at desc);

create table if not exists ai_update_suggestions (
  id bigserial primary key,
  research_profile_id bigint not null references research_profiles(id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  summary text not null,
  supports text[] not null default '{}',
  weakens text[] not null default '{}',
  counter_evidence text[] not null default '{}',
  changed_variables text[] not null default '{}',
  missing_evidence text[] not null default '{}',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decision_note text,
  raw_payload jsonb not null default '{}'::jsonb
);

create index if not exists ai_update_suggestions_profile_status_idx
  on ai_update_suggestions (research_profile_id, status, created_at desc);

create table if not exists ai_suggestion_decisions (
  id bigserial primary key,
  suggestion_id bigint not null references ai_update_suggestions(id),
  action text not null check (action in ('accepted', 'rejected')),
  note text,
  created_at timestamptz not null default now()
);
