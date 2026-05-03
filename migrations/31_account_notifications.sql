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
