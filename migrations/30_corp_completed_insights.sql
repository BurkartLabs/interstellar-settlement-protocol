create table if not exists corp_completed_insights (
  id            bigserial primary key,
  corp_id       text not null references corporations(id) on delete cascade,
  program_id    text not null,
  level         int not null default 1,
  completed_at  bigint
);
create index if not exists ix_completed_insights_corp on corp_completed_insights(corp_id);
