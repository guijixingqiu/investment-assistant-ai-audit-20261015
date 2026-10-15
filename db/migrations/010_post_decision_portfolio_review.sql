alter table post_decision_reviews
  add column if not exists portfolio_review_snapshot jsonb;
