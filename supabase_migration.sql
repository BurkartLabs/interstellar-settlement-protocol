-- ============================================================================
--  ISP — Normalized schema migration
--  Replaces the monolithic account_state.state_json blob with per-domain tables.
--  Idempotent: safe to re-run.
--
--  Conventions:
--    * ms-epoch timestamps stored as bigint (matches Date.now() in JS)
--    * ISO timestamps stored as timestamptz
--    * Every per-corp table cascades on corp delete
--    * `account_state` is intentionally NOT dropped here; that happens in a
--      follow-up cleanup migration after all code paths are migrated.
--    * No explicit BEGIN/COMMIT: some clients (Supabase SQL editor, psql -c,
--      PostgREST) run scripts via prepared statements and reject multi-command
--      transactions. Run this whole file in one submission and it will still
--      execute as a single implicit transaction.
-- ============================================================================

-- ─── Identity / session ─────────────────────────────────────────────────────

create table if not exists refresh_tokens (
  id            bigserial primary key,
  account_id    text not null references accounts(id) on delete cascade,
  token         text not null unique,
  expires_at    bigint not null,
  created_at    timestamptz not null default now()
);
create index if not exists ix_refresh_tokens_account on refresh_tokens(account_id);
create index if not exists ix_refresh_tokens_expires on refresh_tokens(expires_at);

-- ─── Corporation core ───────────────────────────────────────────────────────

create table if not exists corporations (
  id                     text primary key,
  account_id             text not null unique references accounts(id) on delete cascade,
  name                   text not null,
  ceo_name               text not null,
  level                  int  not null default 0,
  level_cap              int  not null default 40,
  employee_cap           int  not null default 0,
  employee_count         int  not null default 0,
  building_slots         int  not null default 0,
  current_station_id     text,
  current_system_id      text,
  location               text,
  is_new_player          boolean not null default true,
  registered_at          bigint,
  updated_at             timestamptz not null default now()
);
create index if not exists ix_corporations_account on corporations(account_id);

create table if not exists corp_unlocks (
  corp_id                    text primary key references corporations(id) on delete cascade,
  max_upgrade_tier           int not null default 1,
  max_fleet_size             int not null default 0,
  max_basic_extractor_yards  int not null default 1
);

create table if not exists corp_unlocked_market_sectors (
  corp_id  text not null references corporations(id) on delete cascade,
  sector   text not null,
  primary key (corp_id, sector)
);

create table if not exists corp_unlocked_tech (
  corp_id      text not null references corporations(id) on delete cascade,
  tech_id      text not null,
  unlocked_at  bigint,
  primary key (corp_id, tech_id)
);

create table if not exists corp_milestones_completed (
  corp_id       text not null references corporations(id) on delete cascade,
  milestone     text not null,
  completed_at  bigint,
  primary key (corp_id, milestone)
);

-- ─── Travel ─────────────────────────────────────────────────────────────────

create table if not exists corp_travel (
  corp_id          text primary key references corporations(id) on delete cascade,
  from_station_id  text,
  to_station_id    text,
  from_system_id   text,
  to_system_id     text,
  departed_at      bigint,
  arrives_at       bigint,
  kind             text check (kind in ('intra','interstellar'))
);

-- ─── Finance ────────────────────────────────────────────────────────────────

create table if not exists corp_finances (
  corp_id                   text primary key references corporations(id) on delete cascade,
  credits                   bigint not null default 0,
  liabilities               bigint not null default 0,
  assets                    bigint not null default 0,
  daily_revenue             bigint not null default 0,
  daily_costs               bigint not null default 0,
  liquidity                 bigint not null default 0,
  liquidity_cap             bigint not null default 0,
  liquidity_regen_per_hour  bigint not null default 0,
  last_liquidity_tick       bigint,
  tax_rate_pct              numeric(5,2) not null default 14,
  bond_yield_pct            numeric(5,2) not null default 0,
  exchange_sales_tax_pct    numeric(5,2) not null default 8
);

create table if not exists corp_finance_snapshots (
  id              bigserial primary key,
  corp_id         text not null references corporations(id) on delete cascade,
  taken_at        bigint not null,
  credits         bigint not null,
  liabilities     bigint not null,
  assets          bigint not null,
  daily_revenue   bigint not null,
  daily_costs     bigint not null,
  net_worth       bigint generated always as (assets - liabilities) stored,
  extra           jsonb
);
create index if not exists ix_finance_snap_corp_time on corp_finance_snapshots(corp_id, taken_at desc);

create table if not exists corp_military (
  corp_id              text primary key references corporations(id) on delete cascade,
  light_fighters       int not null default 0,
  destroyers           int not null default 0,
  siege_engines        int not null default 0,
  attack_value         int not null default 0,
  defense_value        int not null default 0,
  rd_bonus_pct         numeric(5,2) not null default 0,
  ceo_leadership_pct   numeric(5,2) not null default 0
);

-- ─── Buildings / offices / leases ───────────────────────────────────────────

create table if not exists corp_buildings (
  id            text primary key,
  corp_id       text not null references corporations(id) on delete cascade,
  station_id    text,
  name          text not null,
  tier          int not null default 1,
  status        text not null default 'Operational',
  built_at      bigint,
  completes_at  bigint
);
create index if not exists ix_buildings_corp on corp_buildings(corp_id);

create table if not exists corp_offices (
  id              text primary key,
  corp_id         text not null references corporations(id) on delete cascade,
  station_id      text not null,
  body            text,
  system_id       text,
  name            text,
  tier            int not null default 1,
  rented_at       bigint,
  rented_until    bigint,
  duration_days   int
);
create index if not exists ix_offices_corp on corp_offices(corp_id);

create table if not exists corp_mining_leases (
  id              text primary key,
  corp_id         text not null references corporations(id) on delete cascade,
  body            text not null,
  lease_type      text,
  cost            bigint not null default 0,
  building_slots  int not null default 0,
  issued_at       bigint,
  expires_at      bigint
);
create index if not exists ix_leases_corp on corp_mining_leases(corp_id);

-- ─── Mining (silicate extractors) ───────────────────────────────────────────

create table if not exists corp_extractors (
  id                       text primary key,
  corp_id                  text not null references corporations(id) on delete cascade,
  lease_id                 text references corp_mining_leases(id) on delete set null,
  name                     text not null,
  tier                     int not null default 1,
  active                   boolean not null default false,
  started_at               bigint,
  last_tick_at             bigint,
  ends_at                  bigint,
  last_completed_at        bigint,
  throughput_per_hour      numeric(12,4) not null default 0,
  operation_cost_per_hour  numeric(12,4) not null default 0,
  total_mined              bigint not null default 0,
  total_spent              bigint not null default 0,
  mined_remainder          numeric(12,6) not null default 0,
  downtime_active          boolean not null default false,
  downtime_started_at      bigint,
  downtime_recovered_at    bigint
);
create index if not exists ix_extractors_corp on corp_extractors(corp_id);
create index if not exists ix_extractors_lease on corp_extractors(lease_id);

-- ─── Refineries ─────────────────────────────────────────────────────────────

create table if not exists corp_refineries (
  id                       text primary key,
  corp_id                  text not null references corporations(id) on delete cascade,
  name                     text not null,
  tier                     int not null default 1,
  active                   boolean not null default false,
  chain_id                 text,
  started_at               bigint,
  last_tick_at             bigint,
  ends_at                  bigint,
  cycles_completed         int not null default 0,
  total_input_consumed     bigint not null default 0,
  total_output_produced    bigint not null default 0
);
create index if not exists ix_refineries_corp on corp_refineries(corp_id);

-- ─── Asteroid mining ────────────────────────────────────────────────────────

create table if not exists corp_asteroid_mining (
  corp_id          text primary key references corporations(id) on delete cascade,
  probe_count      int not null default 0,
  max_probes       int not null default 2,
  max_deployments  int not null default 1
);

create table if not exists corp_probe_fabrications (
  id            text primary key,
  corp_id       text not null references corporations(id) on delete cascade,
  started_at    bigint not null,
  completes_at  bigint not null,
  status        text not null default 'in_progress'
    check (status in ('in_progress','complete'))
);
create index if not exists ix_probe_fab_corp on corp_probe_fabrications(corp_id);

create table if not exists corp_expeditions (
  id                  text primary key,
  corp_id             text not null references corporations(id) on delete cascade,
  belt_key            text not null,
  system_id           text not null,
  duration            text not null check (duration in ('short','standard','extended')),
  deployed_at         bigint not null,
  completes_at        bigint not null,
  last_tick_at        bigint,
  launch_cost         bigint not null default 0,
  status              text not null default 'active'
    check (status in ('active','completed')),
  completed_at        bigint,
  deposit_station_id  text
);
create index if not exists ix_expeditions_corp_status on corp_expeditions(corp_id, status);

create table if not exists corp_expedition_yields (
  expedition_id  text not null references corp_expeditions(id) on delete cascade,
  resource       text not null,
  quantity       bigint not null,
  primary key (expedition_id, resource)
);

create table if not exists corp_scouted_belts (
  corp_id     text not null references corporations(id) on delete cascade,
  belt_key    text not null,
  scouted_at  bigint,
  primary key (corp_id, belt_key)
);

-- ─── Inventory ──────────────────────────────────────────────────────────────

create table if not exists corp_station_inventory (
  corp_id     text not null references corporations(id) on delete cascade,
  station_id  text not null,
  item        text not null,
  quantity    bigint not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (corp_id, station_id, item)
);
create index if not exists ix_inventory_corp_station on corp_station_inventory(corp_id, station_id);

-- ─── Trade history ──────────────────────────────────────────────────────────

create table if not exists corp_trade_history (
  id            text primary key,
  corp_id       text not null references corporations(id) on delete cascade,
  type          text not null,
  item          text not null,
  quantity      bigint not null,
  unit_price    numeric(14,4) not null,
  total         bigint not null,
  counterparty  text,
  at            bigint not null
);
create index if not exists ix_trade_corp_at on corp_trade_history(corp_id, at desc);

-- ─── Missions / agents / contracts ──────────────────────────────────────────

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

create table if not exists corp_agent_reputation (
  corp_id          text not null references corporations(id) on delete cascade,
  agent_id         text not null,
  completed_count  int not null default 0,
  standing         numeric(8,3) not null default 0,
  primary key (corp_id, agent_id)
);

create table if not exists corp_contract_offerings (
  corp_id          text primary key references corporations(id) on delete cascade,
  next_refresh_at  bigint not null default 0
);

create table if not exists corp_contract_offering_missions (
  corp_id              text not null references corporations(id) on delete cascade,
  slot                 int  not null,
  mission_template_id  text not null,
  primary key (corp_id, slot)
);

-- ─── R&D / CEO Insight ──────────────────────────────────────────────────────

create table if not exists corp_rd_queue (
  id            bigserial primary key,
  corp_id       text not null references corporations(id) on delete cascade,
  node_id       text not null,
  position      int  not null default 0,
  status        text not null default 'queued'
    check (status in ('queued','in_progress','complete')),
  queued_at     bigint,
  started_at    bigint,
  completes_at  bigint
);
create index if not exists ix_rd_queue_corp_pos on corp_rd_queue(corp_id, position);

create table if not exists corp_ceo_insight_queue (
  id            bigserial primary key,
  corp_id       text not null references corporations(id) on delete cascade,
  node_id       text not null,
  position      int  not null default 0,
  status        text not null default 'queued'
    check (status in ('queued','in_progress','complete')),
  queued_at     bigint,
  started_at    bigint,
  completes_at  bigint
);
create index if not exists ix_insight_queue_corp_pos on corp_ceo_insight_queue(corp_id, position);

create table if not exists corp_completed_insights (
  id            bigserial primary key,
  corp_id       text not null references corporations(id) on delete cascade,
  program_id    text not null,
  level         int not null default 1,
  completed_at  bigint
);
create index if not exists ix_completed_insights_corp on corp_completed_insights(corp_id);

-- ─── Notifications ──────────────────────────────────────────────────────────

create table if not exists account_notifications (
  id          text primary key,
  account_id  text not null references accounts(id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text not null,
  created_at  bigint not null,
  read_at     bigint
);
create index if not exists ix_notifications_account_time on account_notifications(account_id, created_at desc);

-- ─── Messages ───────────────────────────────────────────────────────────────

create table if not exists account_messages (
  id                text primary key,
  account_id        text not null references accounts(id) on delete cascade,
  from_type         text not null check (from_type in ('system','player')),
  from_id           text,
  from_name         text,
  to_account_id     text,
  to_corp_name      text,
  to_name           text,
  subject           text,
  body              text,
  sent_at           bigint not null,
  read_at           bigint,
  folder            text not null default 'inbox'
    check (folder in ('inbox','sent','archive','trash','draft')),
  trashed_at        bigint
);
create index if not exists ix_messages_account_folder_time
  on account_messages(account_id, folder, sent_at desc);
