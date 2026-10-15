-- NULL preserves the exact legacy default filter and its immutable captures.
alter table research_futu_financial_statement_captures
  add column requested_financial_type integer
  check (requested_financial_type in (5, 7));
