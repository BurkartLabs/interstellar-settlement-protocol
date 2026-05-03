create table if not exists corp_ceo_insight_queue (
  id            bigserial primary key,
  corp_id       text not null references corporations(id) on delete cascade,
  node_id       text not null,
  position      int  not null default 0,
  status        text not null default 'queued'
    check (status in ('queued','in_progress','complete')),
  queued_at     bigint,
  started_at    bigint,
  completes_at  bigint
);
create index if not exists ix_insight_queue_corp_pos on corp_ceo_insight_queue(corp_id, position);
