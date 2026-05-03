create table if not exists corp_active_missions (
  id                    text primary key,
  corp_id               text not null references corporations(id) on delete cascade,
  mission_template_id   text not null,
  accepted_at           bigint,
  expires_at            bigint,
  progress_quantity     bigint not null default 0,
  status                text not null default 'active'
);
create index if not exists ix_active_missions_corp on corp_active_missions(corp_id);
