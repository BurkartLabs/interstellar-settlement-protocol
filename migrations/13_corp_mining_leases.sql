create table if not exists corp_mining_leases (
  id              text primary key,
  corp_id         text not null references corporations(id) on delete cascade,
  body            text not null,
  lease_type      text,
  cost            bigint not null default 0,
  building_slots  int not null default 0,
  issued_at       bigint,
  expires_at      bigint
);
create index if not exists ix_leases_corp on corp_mining_leases(corp_id);
