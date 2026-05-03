create table if not exists corporations (
  id                     text primary key,
  account_id             text not null unique references accounts(id) on delete cascade,
  name                   text not null,
  ceo_name               text not null,
  level                  int  not null default 0,
  level_cap              int  not null default 40,
  employee_cap           int  not null default 0,
  employee_count         int  not null default 0,
  building_slots         int  not null default 0,
  current_station_id     text,
  current_system_id      text,
  location               text,
  is_new_player          boolean not null default true,
  registered_at          bigint,
  updated_at             timestamptz not null default now()
);
create index if not exists ix_corporations_account on corporations(account_id);
