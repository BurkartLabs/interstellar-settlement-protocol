-- Persist refinery cycle scale (number of batches queued for the run) so a
-- restart doesn't lose it. Without this column the hydrated refinery row
-- defaults cycleScale to 1, causing the cycle to produce only one batch's
-- worth of output regardless of how many input units were consumed.
alter table corp_refineries
  add column if not exists cycle_scale int not null default 1;
