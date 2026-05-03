create table if not exists corp_finances (
  corp_id                   text primary key references corporations(id) on delete cascade,
  credits                   bigint not null default 0,
  liabilities               bigint not null default 0,
  assets                    bigint not null default 0,
  daily_revenue             bigint not null default 0,
  daily_costs               bigint not null default 0,
  liquidity                 bigint not null default 0,
  liquidity_cap             bigint not null default 0,
  liquidity_regen_per_hour  bigint not null default 0,
  last_liquidity_tick       bigint,
  tax_rate_pct              numeric(5,2) not null default 14,
  bond_yield_pct            numeric(5,2) not null default 0,
  exchange_sales_tax_pct    numeric(5,2) not null default 8
);
