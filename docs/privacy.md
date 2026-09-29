# A player's data: export and deletion (ISP-264, AB#960)

GDPR Article 20 (portability) and Article 17 (erasure), from the Account button in the game's header.
Code: `server/accountData.js`; routes in `server/routes/account.js`; dialog in `public/scripts/views/accountData.js`.

## Where the data lives

The item assumed the v0.6 Postgres schema. The server keeps its world in files under its data directory instead, so
`DATA_FILES` in `server/accountData.js` plays the part of the account-keyed tables. It classifies every file and folder
the server writes there:

- **account**: records of one account;
- **shared**: shared history that names corporations;
- **none**: nothing about any account.

`tests/integration/account-data.test.js` scans `server/` for every name joined onto the data directory. It fails until
a new one is classified, so a store added later cannot be missed.

## Export: `GET /api/accounts/:id/export`

The owner only (401 without a login, 403 for another account), limited to 10 an hour, sent `Cache-Control: no-store,
private` as a file download. It returns one key per store:

- the account record and corporation;
- statements;
- conversations with every message;
- ledger lines;
- the legacy-investment archive;
- chat lines under the current name;
- in each shared store, the records that name the account's id or its corporation's publicId.

The password hash, refresh tokens and one-time tokens are listed as withheld and never sent.

## Deletion: `POST /api/accounts/:id/delete-account`

It needs the password and the word `DELETE`, and is limited per account to 5 an hour, like a login. It is all or
nothing: every store is copied first and put back if any step fails.

**Erased:**
- the email;
- the password hash;
- refresh tokens, and the verification and reset tokens;
- notifications;
- the account's mail. Its inbox goes. In the other side's copy of each conversation, its messages keep their place but
  read "This message was deleted with its sender's account." and their sender is the label below.

**Anonymised:** the corporation's name, wherever a name field holds it in any store, becomes "Anonymised corporation".
That covers raids, forum posts, cases, patents, concessions, dominance and control history, chat lines, other players'
raid reports and old mail. The CEO's name becomes "Anonymised CEO" on the corporation itself; CEO names are not unique,
so they are not replaced elsewhere. The label is a reserved name nobody can register.

**Access:** every access token is refused at once (`passwordChangedAt` moves), the refresh cookie is cleared, and no
login, refresh or reset can reach the account: it has no email or password.

**Kept, deliberately:**
- **A tombstone record with the corporation's game state**: its id, publicId, holdings and statements. Other players'
  trades, loans, contracts and cases still refer to it, and nothing in it identifies a person.
- **The settlement and item ledgers**: financial records of moves between account ids, with no names.
- **Free text that mentions the old name**: a sentence in another player's notification or message body. Only name
  fields are rewritten; rewriting free text would risk corrupting it.
- **Chat lines written under an earlier name**: chat lines carry no account id, only the name at the time.
