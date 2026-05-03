create table if not exists corp_probe_fabrications (
  id            text primary key,
  corp_id       text not null references corporations(id) on delete cascade,
  started_at    bigint not null,
  completes_at  bigint not null,
  status        text not null default 'in_progress'
    check (status in ('in_progress','complete'))
);
create index if not exists ix_probe_fab_corp on corp_probe_fabrications(corp_id);
