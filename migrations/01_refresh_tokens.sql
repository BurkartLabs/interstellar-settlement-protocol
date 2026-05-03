create table if not exists refresh_tokens (
  id            bigserial primary key,
  account_id    text not null references accounts(id) on delete cascade,
  token         text not null unique,
  expires_at    bigint not null,
  created_at    timestamptz not null default now()
);
create index if not exists ix_refresh_tokens_account on refresh_tokens(account_id);
create index if not exists ix_refresh_tokens_expires on refresh_tokens(expires_at);
