create table if not exists corp_extractors (
  id                       text primary key,
  corp_id                  text not null references corporations(id) on delete cascade,
  lease_id                 text references corp_mining_leases(id) on delete set null,
  name                     text not null,
  tier                     int not null default 1,
  active                   boolean not null default false,
  started_at               bigint,
  last_tick_at             bigint,
  ends_at                  bigint,
  last_completed_at        bigint,
  throughput_per_hour      numeric(12,4) not null default 0,
  operation_cost_per_hour  numeric(12,4) not null default 0,
  total_mined              bigint not null default 0,
  total_spent              bigint not null default 0,
  mined_remainder          numeric(12,6) not null default 0,
  downtime_active          boolean not null default false,
  downtime_started_at      bigint,
  downtime_recovered_at    bigint
);
create index if not exists ix_extractors_corp on corp_extractors(corp_id);
create index if not exists ix_extractors_lease on corp_extractors(lease_id);
