-- ISP-197 (AB#891): the conglomerate a corporation belongs to, if any.
alter table corporations add column if not exists conglomerate_id text references conglomerates(id);
