create table if not exists corp_travel (
  corp_id          text primary key references corporations(id) on delete cascade,
  from_station_id  text,
  to_station_id    text,
  from_system_id   text,
  to_system_id     text,
  departed_at      bigint,
  arrives_at       bigint,
  kind             text check (kind in ('intra','interstellar'))
);
