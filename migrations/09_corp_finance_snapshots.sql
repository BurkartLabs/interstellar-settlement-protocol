create table if not exists corp_finance_snapshots (
  id              bigserial primary key,
  corp_id         text not null references corporations(id) on delete cascade,
  taken_at        bigint not null,
  credits         bigint not null,
  liabilities     bigint not null,
  assets          bigint not null,
  daily_revenue   bigint not null,
  daily_costs     bigint not null,
  net_worth       bigint generated always as (assets - liabilities) stored,
  extra           jsonb
);
create index if not exists ix_finance_snap_corp_time on corp_finance_snapshots(corp_id, taken_at desc);
