create table if not exists corp_unlocked_market_sectors (
  corp_id  text not null references corporations(id) on delete cascade,
  sector   text not null,
  primary key (corp_id, sector)
);
