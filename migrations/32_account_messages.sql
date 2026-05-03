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
