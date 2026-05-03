create table if not exists corp_station_inventory (
  corp_id     text not null references corporations(id) on delete cascade,
  station_id  text not null,
  item        text not null,
  quantity    bigint not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (corp_id, station_id, item)
);
create index if not exists ix_inventory_corp_station on corp_station_inventory(corp_id, station_id);
