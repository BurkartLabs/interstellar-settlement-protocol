create table if not exists corp_buildings (
  id            text primary key,
  corp_id       text not null references corporations(id) on delete cascade,
  station_id    text,
  name          text not null,
  tier          int not null default 1,
  status        text not null default 'Operational',
  built_at      bigint,
  completes_at  bigint
);
create index if not exists ix_buildings_corp on corp_buildings(corp_id);
