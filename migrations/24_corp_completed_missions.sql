create table if not exists corp_completed_missions (
  id                    bigserial primary key,
  corp_id               text not null references corporations(id) on delete cascade,
  mission_template_id   text not null,
  title                 text,
  type                  text,
  agent_id              text,
  reward                text,
  completed_at          bigint not null
);
create index if not exists ix_completed_missions_corp on corp_completed_missions(corp_id, completed_at desc);
