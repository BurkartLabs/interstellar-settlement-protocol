create table if not exists corp_military (
  corp_id              text primary key references corporations(id) on delete cascade,
  light_fighters       int not null default 0,
  destroyers           int not null default 0,
  siege_engines        int not null default 0,
  attack_value         int not null default 0,
  defense_value        int not null default 0,
  rd_bonus_pct         numeric(5,2) not null default 0,
  ceo_leadership_pct   numeric(5,2) not null default 0
);
