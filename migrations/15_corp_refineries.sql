create table if not exists corp_refineries (
  id                       text primary key,
  corp_id                  text not null references corporations(id) on delete cascade,
  name                     text not null,
  tier                     int not null default 1,
  active                   boolean not null default false,
  chain_id                 text,
  started_at               bigint,
  last_tick_at             bigint,
  ends_at                  bigint,
  cycles_completed         int not null default 0,
  total_input_consumed     bigint not null default 0,
  total_output_produced    bigint not null default 0
);
create index if not exists ix_refineries_corp on corp_refineries(corp_id);
