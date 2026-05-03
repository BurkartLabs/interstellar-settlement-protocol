create table if not exists corp_expeditions (
  id                  text primary key,
  corp_id             text not null references corporations(id) on delete cascade,
  belt_key            text not null,
  system_id           text not null,
  duration            text not null check (duration in ('short','standard','extended')),
  deployed_at         bigint not null,
  completes_at        bigint not null,
  last_tick_at        bigint,
  launch_cost         bigint not null default 0,
  status              text not null default 'active'
    check (status in ('active','completed')),
  completed_at        bigint,
  deposit_station_id  text
);
create index if not exists ix_expeditions_corp_status on corp_expeditions(corp_id, status);
