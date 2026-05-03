create table if not exists corp_milestones_completed (
  corp_id       text not null references corporations(id) on delete cascade,
  milestone     text not null,
  completed_at  bigint,
  primary key (corp_id, milestone)
);
