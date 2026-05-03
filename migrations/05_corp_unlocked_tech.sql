create table if not exists corp_unlocked_tech (
  corp_id      text not null references corporations(id) on delete cascade,
  tech_id      text not null,
  unlocked_at  bigint,
  primary key (corp_id, tech_id)
);
