-- ISP-197 (AB#891): conglomerates, for v0.6's Postgres (docs/design/CONGLOMERATES.md). Until then they live in the
-- accounts snapshot (server/game/conglomerates.js), which enforces the same unique name in its own index.
create table if not exists conglomerates (
  id               text primary key,
  name             text not null,
  name_key         text not null,
  founder_corp_id  text not null references corporations(id),
  level            int  not null default 1,
  max_members      int  not null default 5,
  emblem           int  not null,
  colour           int  not null,
  treasury_credits bigint not null default 0,
  founded_at       bigint not null
);
create unique index if not exists ux_conglomerates_name_key on conglomerates(name_key);
