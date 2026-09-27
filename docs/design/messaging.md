# Player messaging, chat and forums at scale (AB#909)

Design only. It says how private messages, chat history and forum threads are stored, indexed, paged, limited and
delivered, and how today's player mail moves across. The code is v0.12 (Conglomerates, Feature AB#396, plan line
"Private messaging between players") and the v0.6 Postgres move (Decision #591).

## What the Board decided, and what that means here

- **D-0.12-1 (AB#707)**, private messaging between players. Board: *"This should just be able to scale...."*
- **D-0.5-4 (AB#696)**, chat, forums and player mail in the playtest. Board: *"no safety measures. And yes ship in
  playtest"*

Read together: private messaging is **free text between any two corporations**. **No filter, no block, no report and
no moderation is built**, for messages or for the chat, forums and mail that already exist. The work is making it
scale. The size and rate limits below exist to protect the server (its disk, memory, write rate and fan-out), **not to
police content**. None of them looks at what a message says. None of them depends on who the recipient is or whether
they want it. The two exceptions are recipient-side conditions the server needs: the recipient must exist, and the
recipient's inbox is read in pages.

## What is wrong today

Measured, not guessed: PERFORMANCE.md (AB#729, `npm run bench:ticks`).

| Where | How it is stored | Why it does not scale |
| --- | --- | --- |
| Player mail (`server/game/messaging.js`) | Two copies of each message (inbox and sent) in `account.messages[]`, inside `accounts-snapshot.json` | Every account change rewrites the whole snapshot 500 ms later. At 1,000 corporations with no mail, that file is already 30.6 MB and a full write takes 230 ms. Mail grows it by about 2 x body size per message, with no bound. Reading an inbox copies the whole array (`listAccountMessages`) and returns all of it, unpaged. |
| Chat (`appendChatMessage`, `server/game/store.js`) | `state.chatLog[channel]`, the last 120 lines, inside `state.json` | Bounded, but every line rewrites the whole world file (market, forums, everything). History beyond 120 lines is lost. Local chat finds its recipients by scanning every socket (`realtime.js`). |
| Forums (`server/routes/forums.js`) | `state.forums.threads[]` with replies nested inside, in `state.json` | Unbounded. Every post rewrites the world file, and `emitForumsUpdated` sends **every thread with every reply** to **every socket**. |

Mail is addressed correctly now: by corporation `publicId`, with account ids kept on the server (Bugs #711, #754,
#1130, #1134). This design keeps that rule. It does not revisit authentication or attribution, which Bugs AB#710,
AB#711 and AB#749 fixed.

## Storage model (Postgres, v0.6 onward)

Messages live in their own tables, **never in the per-account state**. An account read or write costs the same with
an empty inbox or a million messages.

```sql
-- One row per pair of corporations that have ever written to each other. Canonical order: a < b.
create table conversations (
  id               text primary key,               -- 'cv_' + time-sortable id; the only id a client sees
  account_a        text not null references accounts(id) on delete cascade,
  account_b        text not null references accounts(id) on delete cascade,
  created_at       bigint not null,
  last_message_id  text,
  last_message_at  bigint not null,
  message_count    integer not null default 0,
  constraint conversations_pair_order check (account_a < account_b),
  constraint conversations_pair unique (account_a, account_b)
);

-- Each side's own view of a conversation: what it has read, and whether it archived or cleared it.
create table conversation_members (
  conversation_id  text not null references conversations(id) on delete cascade,
  account_id       text not null references accounts(id) on delete cascade,
  last_read_at     bigint not null default 0,
  unread_count     integer not null default 0,
  archived         boolean not null default false,
  cleared_before   bigint not null default 0,      -- this side hides everything sent at or before this time
  last_message_at  bigint not null,                -- copied from conversations so the inbox needs one index
  primary key (conversation_id, account_id)
);

create table messages (
  id               text primary key,               -- 'm_' + time-sortable id (ULID-style), unique and ordered
  conversation_id  text not null references conversations(id) on delete cascade,
  sender_id        text not null references accounts(id) on delete cascade,
  subject          text,                           -- kept for migrated mail; new messages leave it null
  body             text not null,
  sent_at          bigint not null
);

create table message_drafts (                      -- a draft belongs to one account, not a conversation
  id               text primary key,
  account_id       text not null references accounts(id) on delete cascade,
  to_corp_id       text,                           -- the recipient's publicId, as today (Bug #711)
  to_corp_name     text,
  subject          text,
  body             text,
  updated_at       bigint not null
);
```

**System mail** (welcome letter, payroll notices, the liaison) is not a conversation. It stays per account in
`account_messages` (`migrations/32_account_messages.sql`), with `from_type = 'system'` only, under the same page and
index rules as notifications (`migrations/31`).

**Why pairs, not a message table keyed by recipient.** The Board's shape is "conversations between two corporations".
A pair row holds each message once, where today's mail holds two copies. The inbox also becomes one row per
correspondent, not one per message. Group conversations, if a conglomerate ever wants one, fit this model as a member
table with more than two rows. The pair constraint is the only thing to relax.

## Indexes

```sql
create index ix_members_inbox    on conversation_members (account_id, archived, last_message_at desc, conversation_id);
create index ix_messages_thread  on messages (conversation_id, id desc);
create index ix_messages_sender  on messages (sender_id, sent_at desc);     -- the rate limit and the sent view
create index ix_drafts_account   on message_drafts (account_id, updated_at desc);
-- conversations_pair (unique) already finds the conversation for a pair when a message is sent.
```

Every query below is one index range scan with no sort step:

| Operation | Query shape | Index |
| --- | --- | --- |
| Inbox page | members where account_id = $me and archived = $f and (last_message_at, conversation_id) < cursor, order by both desc, limit n | `ix_members_inbox` |
| Thread page | messages where conversation_id = $c and id < cursor and sent_at > my cleared_before, order by id desc, limit n | `ix_messages_thread` |
| Send | upsert conversation by (a, b); insert message; update both member rows | `conversations_pair`, primary keys |
| Unread badge | sum(unread_count) over my non-archived member rows (or a cached counter on the account row) | `ix_members_inbox` |

## Pagination: cursors, never offsets

- **Inbox:** 30 conversations a page, 100 at most on request. The cursor is the last row's
  `(last_message_at, conversation_id)`, base64url-encoded and opaque to the client. The tie-break on id means two
  conversations touched in the same millisecond are neither skipped nor shown twice.
- **Thread:** 50 messages a page, newest first, 100 at most. The cursor is the last message's `id`. Ids are
  time-sortable and unique, so the id alone is a total order.
- **No `OFFSET`**, anywhere. Page 1,000 costs the same as page 1, and a message arriving mid-scroll does not shift
  what the next page returns.
- A response carries `nextCursor` (null at the end). A cursor the server cannot decode is a 400, not a restart from
  the top.
- Unread: opening a thread sets `last_read_at` to its newest message and `unread_count` to 0 in one update. A send
  adds 1 to the recipient's `unread_count` and sets both sides' `last_message_at`. If the recipient had archived the
  conversation it is un-archived, as mail does today.

## Limits that protect the server

These look at size and rate. None reads the text, and none is per recipient.

| Limit | Value | Why |
| --- | --- | --- |
| Message body | 8,000 characters and 32 KB of UTF-8, whichever comes first; empty is refused | 8,000 is today's mail cap (`sendPlayerMessage`), so migrated mail always fits. The byte cap stops 8,000 four-byte characters from being four times the storage. |
| Subject (migrated mail only) | 200 characters | Today's cap |
| Request body | Express `json()` default, 100 KB | Already in place. A message never needs more. |
| Sends per sender | 30 a minute, 600 an hour (env `ISP_RATE_LIMIT_MESSAGE_*`, the same `limiter()` shape as `rateLimiters.js`) | Caps one account's write rate and the storage it can add: 600 x 32 KB is about 19 MB an hour worst case. A player typing never reaches it. |
| New conversations per sender | 60 an hour | A new conversation creates three rows and an index entry per recipient. This bounds that fan-out. It says nothing about whom a player may write to. |
| Chat lines per account | 10 per 10 seconds, 300 characters (today's `CHAT_MAX_LENGTH`) | Chat fans out to every socket in the channel, so its rate is the fan-out rate |
| Forum threads / posts per account | 10 threads an hour, 120 posts an hour; title 200, body 8,000, reply 4,000 (today's caps) | The same write-rate reasoning |
| Draft count per account | 200 | Drafts are never delivered, so this is the only thing bounding them |

Above a limit the server answers **429** with `Retry-After`, through `throttledResponse`, as the other limiters do.
The limiter stores are the existing in-memory `failOpenStore`. When ISP runs more than one instance, they move to a
shared store (Postgres or Redis) so the count is per account, not per instance.

**Retention.** Messages are kept. A side that "deletes" a conversation sets its `cleared_before` to now, which hides
everything up to then from that side only. A nightly job deletes messages that **both** sides have cleared past, and
conversations with no messages left. There is no global expiry, so nobody's history disappears on the server's
schedule.

## Live delivery

- A send stores first, then emits `messages:new` `{ conversationId, message, unread }` to the recipient's account room
  through `emitToAccount` (Bug #1021's room, re-verified per delivery by `checkSocketAuth`, ISP-67). It also emits to
  the sender's room, so their other tabs update. No account id goes in the event (Bug #1134): the other side is named
  by `publicId` and corporation name.
- A socket that was offline reads the inbox page on reconnect. The socket is a notification, never the only copy.
- **Chat:** local chat stops scanning every socket. Each authenticated socket joins `system:<systemId>` on connect and
  moves rooms on arrival (`travelTick`), so a local line is one `io.to(room).emit`.
- **Forums:** `forums:updated` stops sending all forums to everyone. It sends the one changed thread (or the new
  post), and clients page the rest.
- Past one server instance, socket.io needs an adapter (the Postgres or Redis adapter) so a room spans instances. The
  room names above do not change.

## Chat history and forums on the same model

```sql
create table chat_messages (
  id          text primary key,             -- time-sortable
  channel     text not null,                -- 'global', 'trade', 'local:<systemId>'
  author_id   text not null references accounts(id) on delete cascade,
  author_name text not null,                -- the corporation name at the time, as the broadcast carries it
  content     text not null,
  created_at  bigint not null
);
create index ix_chat_channel on chat_messages (channel, id desc);

create table forum_threads (
  id            text primary key,
  category      text not null,
  author_id     text not null references accounts(id) on delete cascade,
  title         text not null,
  body          text not null,
  created_at    bigint not null,
  last_post_at  bigint not null,
  post_count    integer not null default 0,
  like_count    integer not null default 0
);
create index ix_threads_category on forum_threads (category, last_post_at desc, id);

create table forum_posts (
  id          text primary key,             -- time-sortable
  thread_id   text not null references forum_threads(id) on delete cascade,
  author_id   text not null references accounts(id) on delete cascade,
  body        text not null,
  created_at  bigint not null
);
create index ix_posts_thread on forum_posts (thread_id, id);

create table forum_likes (thread_id text not null references forum_threads(id) on delete cascade,
  account_id text not null references accounts(id) on delete cascade, primary key (thread_id, account_id));
```

- **Chat** sends the last 50 lines of each channel the socket can see in `state:init`, and pages back 50 at a time by
  cursor on `id`. History is kept 30 days per channel. It is bulk, not correspondence, and 30 days of busy global chat
  is the table's largest term. A nightly delete by `created_at` keeps it bounded.
- **Forums** page threads 25 at a time by `(last_post_at, id)` within a category, and posts 50 at a time by `id`
  within a thread. The like count is a column updated with the like row, so a thread list never counts rows.
- Neither chat nor forums lives in `state.json` any more, so a chat line or a post no longer rewrites the market.

## If v0.12 comes before Postgres

v0.12 is planned after v0.6. If it comes first anyway, the same model runs on files in the data directory. The one
rule is still that nothing message-shaped goes in `accounts-snapshot.json` or `state.json`:

- `data/messages/<conversationId>.jsonl`: messages appended one line each, never rewritten. A thread page reads the
  file from its end.
- `data/inbox/<accountId>.json`: that account's member rows (small: one entry per correspondent), rewritten only when
  that account's inbox changes.
- Chat and forums: `data/chat/<channel>-<yyyy-mm-dd>.jsonl` and `data/forums/<threadId>.jsonl` the same way.

This is a stopgap with the same API, cursors and limits, so the client does not change when Postgres arrives. The
backfill below then reads these files, not the snapshot.

## Migrating today's player mail

1. **Ship the new tables and the new read path behind the old write path.** The inbox API returns conversations,
   built from `account.messages` on the fly while the backfill has not run, so the client can move first.
2. **Backfill** with `scripts/migrate-mail.mjs`, idempotent and run once per environment:
   - every `fromType: 'player'` message becomes one `messages` row in the conversation for its pair
     (`fromId`, `toAccountId`), keeping `subject`, `body` and `sentAt`;
   - the sender's `sent` copy and the recipient's `inbox` copy are the **same message**. They are matched on
     (`fromId`, `toAccountId`, `sentAt`, `subject`, `body`) and written once. An unmatched copy (one side trashed and
     purged it) is written alone;
   - each side's `readAt`, `folder` (archive becomes `archived`, and trash becomes `cleared_before` at its
     `trashedAt`) set its member row;
   - `folder: 'draft'` rows go to `message_drafts`;
   - `fromType: 'system'` rows go to `account_messages`;
   - the script prints per-account counts before and after and **refuses to finish if they differ**. The count is the
     proof, not the exit code (T-012).
3. **Switch writes** to the tables. Then drop `messages` from the account objects and from the snapshot. The first
   write after the switch shrinks `accounts-snapshot.json` by everything mail had added to it.
4. **Keep the pre-migration snapshot** in the data directory until a playtest week has passed without a mail bug.

Chat's 120-line tails and the forum threads move the same way: read from `state.json` once, write the rows, then stop
writing them there.

## Load target, and the probe that measures it

**Target (a bot number, not a player number):** with **10,000 corporations** and **1,000,000 seeded messages**,
**p95 under 50 ms** for each of: sending one message, reading one inbox page (30 conversations), and reading one
thread page (50 messages). This is on the same machine class as PERFORMANCE.md, against a local Postgres.

**Probe:** `npm run bench:messaging` (`scripts/bench-messaging.mjs`), built like AB#729's `bench:ticks`:

- It seeds 10,000 corporations and 1,000,000 messages over their pairs. The seeding is skewed (a few thousand busy
  pairs and a long tail of one-message pairs), because uniform seeding flatters every index.
- It times 1,000 of each operation through the real service functions. It prints median, p95 and max, plus the rows
  and bytes the tables hold.
- It fails if any p95 is over its target, so it can gate the PR that builds this.

**What it measures, and what it does not (P-PROXY):** server-side time in one process, including the database round
trip. It does not measure network latency, socket delivery to real clients, many instances, or how players actually
write. A bot's messages are uniform in size and never read. It says the storage and indexes hold at that volume, not
that the game feels fast to a player.

## Not built, on purpose

- No word filter, no block or mute, no report button, no moderator tool or queue, no age gate (AB#696, AB#707).
- No per-recipient limit, and nothing that reads a message's content.
- No end-to-end encryption. Messages are stored in plain text, and the server reads them only to store and page them.

The server keeps its operator's ordinary powers (a database, backups, the ability to delete an account). This
design adds nothing for acting on content.
