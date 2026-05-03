create table if not exists corp_asteroid_mining (
  corp_id          text primary key references corporations(id) on delete cascade,
  probe_count      int not null default 0,
  max_probes       int not null default 2,
  max_deployments  int not null default 1
);
