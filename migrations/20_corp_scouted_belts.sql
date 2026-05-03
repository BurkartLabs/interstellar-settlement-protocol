create table if not exists corp_scouted_belts (
  corp_id     text not null references corporations(id) on delete cascade,
  belt_key    text not null,
  scouted_at  bigint,
  primary key (corp_id, belt_key)
);
