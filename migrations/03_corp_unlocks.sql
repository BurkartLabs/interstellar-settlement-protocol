create table if not exists corp_unlocks (
  corp_id                    text primary key references corporations(id) on delete cascade,
  max_upgrade_tier           int not null default 1,
  max_fleet_size             int not null default 0,
  max_basic_extractor_yards  int not null default 1
);
