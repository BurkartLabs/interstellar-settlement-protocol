create table if not exists corp_contract_offerings (
  corp_id          text primary key references corporations(id) on delete cascade,
  next_refresh_at  bigint not null default 0
);
