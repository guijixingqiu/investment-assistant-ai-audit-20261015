-- Captured URL may be absent for an imported document. Exact document/page binding remains mandatory.
-- No existing row is rewritten. Legacy HTTPS assertions remain readable.
-- Reverse migration requires checking for new URL-less assertions; never manufacture an URL.
alter table research_fundamental_values drop constraint research_fundamental_assertion_shape;
alter table research_fundamental_values add constraint research_fundamental_assertion_shape check (
 assertion_metadata is null or (jsonb_typeof(assertion_metadata)='object'
 and assertion_metadata->>'category' in ('actual','guidance')
 and assertion_metadata->>'unit' in ('currency','currency_per_vehicle','vehicles','ratio','shares')
 and length(assertion_metadata->>'limitation')>0
 and (assertion_metadata->>'sourceUrl' like 'https://%'
      or (assertion_metadata->>'sourceUrl' = ''
          and assertion_metadata->'textBinding'->>'documentId' ~ '^[1-9][0-9]*$'
          and assertion_metadata->'textBinding'->>'pageTextSha256' ~ '^[a-f0-9]{64}$'))));
