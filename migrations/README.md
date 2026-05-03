# Migrations

Run each `.sql` file in numerical order in the Supabase SQL editor (one file per submission).
Each file contains a single `create table` (plus its indexes) so it works with clients that
require single-statement input. All files are idempotent (`create table if not exists`,
`create index if not exists`) — safe to re-run.

Order matters: later tables reference `corporations` (file 02) and `corp_mining_leases` (file 13),
and `corp_expedition_yields` (file 19) references `corp_expeditions` (file 18).

The original combined script (`../supabase_migration.sql`) is kept for reference.
