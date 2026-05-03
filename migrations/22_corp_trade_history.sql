create table if not exists corp_trade_history (
  id            text primary key,
  corp_id       text not null references corporations(id) on delete cascade,
  type          text not null,
  item          text not null,
  quantity      bigint not null,
  unit_price    numeric(14,4) not null,
  total         bigint not null,
  counterparty  text,
  at            bigint not null
);
create index if not exists ix_trade_corp_at on corp_trade_history(corp_id, at desc);
