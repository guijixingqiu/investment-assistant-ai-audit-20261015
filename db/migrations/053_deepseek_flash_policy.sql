-- Preserve immutable V4 receipts while allowing explicit V4.1 authorization.
ALTER TABLE cloud_ai_provider_policy_events
  DROP CONSTRAINT cloud_ai_provider_policy_events_model_check;
ALTER TABLE cloud_ai_provider_policy_events
  ADD CONSTRAINT cloud_ai_provider_policy_events_model_check
  CHECK (model IN ('deepseek-v4-flash', 'deepseek-flash'));
