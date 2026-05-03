-- Add body location column to corp_extractors so an extractor's planet/moon
-- is authoritative on the row itself, not derived from its lease (which can
-- be lost or mis-linked across hydrations).
alter table corp_extractors
  add column if not exists body text;
create index if not exists ix_extractors_corp_body
  on corp_extractors(corp_id, body);
