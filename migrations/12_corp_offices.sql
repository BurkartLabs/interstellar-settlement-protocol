create table if not exists corp_offices (
  id              text primary key,
  corp_id         text not null references corporations(id) on delete cascade,
  station_id      text not null,
  body            text,
  system_id       text,
  name            text,
  tier            int not null default 1,
  rented_at       bigint,
  rented_until    bigint,
  duration_days   int
);
create index if not exists ix_offices_corp on corp_offices(corp_id);
