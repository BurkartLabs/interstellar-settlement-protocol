create table if not exists corp_agent_reputation (
  corp_id          text not null references corporations(id) on delete cascade,
  agent_id         text not null,
  completed_count  int not null default 0,
  standing         numeric(8,3) not null default 0,
  primary key (corp_id, agent_id)
);
