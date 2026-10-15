alter table research_events
  drop constraint if exists research_events_event_kind_check;

alter table research_events
  add constraint research_events_event_kind_check
  check (event_kind in (
    'announcement',
    'financial_report',
    'corporate_action',
    'major_news',
    'news'
  ));
