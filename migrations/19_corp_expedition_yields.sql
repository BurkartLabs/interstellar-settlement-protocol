create table if not exists corp_expedition_yields (
  expedition_id  text not null references corp_expeditions(id) on delete cascade,
  resource       text not null,
  quantity       bigint not null,
  primary key (expedition_id, resource)
);
