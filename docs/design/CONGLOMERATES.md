# Conglomerates: charter, membership, roles and the level ladder (ISP-194, AB#888)

Design only; it changes no code. It is the first story of v0.12 Conglomerates (Feature AB#396) and fixes the plan's
first two lines, "Conglomerate creation and membership system" and "Conglomerate leveling and capacity upgrades
(5 → 100 members)". The later v0.12 lines (pooling and shared intel, co-owned stations, the dominance overlay) build on
the objects defined here and are not designed here. Read against ISP main `e7da8361`, 2026-09-27. Every number is
*proposed*, for the PM with ECONOMY.md to accept or change, and all of them are in one table at the end so v0.12-03
can move them into `data/economy.json` unchanged.

## What already exists, and what this design keeps

- **The Conglomerate Affairs Bureau** (`data/buildings.json`, id `conglomerate-affairs-bureau`, ISA,
  `action: "coming-soon"`) is in Earth Station Prime, the station every corporation starts at. Its description already
  says what it is for: "formal registration of conglomerates, alliance governance frameworks, membership rules". It
  becomes the one place a conglomerate is chartered, levelled and dissolved. Membership moves (invite, apply, leave)
  happen from the Overview and from mail, anywhere; only the paperwork that costs credits needs the Bureau.
- **The Overview's "Conglomerate Status" card** (`public/scripts/views/overview.js`) already reads
  `data.corp.conglomerateId` and a `data.conglomerates` array of `{ id, name, memberCount, maxMembers }`. Today nothing
  on the server sets either, so every corporation reads "Independent". This design keeps those exact field names:
  `corp.conglomerateId`, and a public summary per conglomerate with `id`, `name`, `memberCount`, `maxMembers`. The card
  then works unchanged. Its line "early groups stay small and unlock higher membership over time" is the ladder below.
- **Corporation names** (`server/corporationName.js`, Bug #433, AB#813): 3 to 40 characters, `A-Z a-z 0-9 space - ' . &`
  only, look-alike letters folded, and refused if it passes for a reserved institution (`RESERVED_CORPORATION_NAMES`
  in `server/game/world.js`: the ISA, GEX, the NPC buyers and the other system senders). Conglomerate names use the
  same validator (below).

## Prior art, and what ISP takes from each

| Game | What it does | What ISP takes | What ISP rejects |
| --- | --- | --- | --- |
| **EVE Online, corporations and alliances** ([EVE University, "Corporation roles"](https://wiki.eveuniversity.org/Corporation_roles)) | Access is a matrix of dozens of roles plus player-named titles, granted per hangar division and per wallet division, and alliances group corporations above that. | Two lessons. A conglomerate is made of **corporations, not people**, as an EVE alliance is. And **money and membership are separate powers**: in EVE, the right to take from a wallet division is granted separately from the right to recruit, and most theft stories are one person holding both. Here, spending the treasury needs the founder. | The matrix itself. EVE's role screen is famously something new directors get wrong, and a mis-set role there empties a hangar. ISP has three fixed roles with a fixed permission table (below) and no titles, no divisions and no per-member grants. That also keeps any free text off the roster (see Names). |
| **World of Warcraft, guild levels** (added in *Cataclysm*, 2010; removed in *Warlords of Draenor*, 2014) | Guilds earned experience from their members' play and levelled up to 25, unlocking perks for every member. Blizzard removed the system partly because it pushed players towards large, established guilds: a small or new guild could not offer the perks a big one already had, so players left friends' guilds for levelled ones. | The warning, as a design constraint: **a level must never be a perk every member receives**. A level here buys capacity (room for more members) and nothing else. | Experience from play. A level is bought with credits the members chose to put in, and it costs upkeep to hold, so a conglomerate that does not need the room does not buy it. |
| **Clash of Clans, clan levels and the 50-member cap** | Clans cap at 50 members however high their level; clan experience unlocks perks for all members. | The cap as a feature: a hard ceiling keeps every group a size where the roster is still people you know, and makes "a second conglomerate" the answer to growth, not "a bigger one". | 50 as the number: the plan line says 5 to 100, and the Board set it. The perks-for-everyone model, for the WoW reason above. |

## The charter: founding a conglomerate

**Who may found one.** A corporation that:

1. is in no conglomerate (`corp.conglomerateId` is empty),
2. has existed for at least `minFounderAgeDays` (7) days, read from the account's `createdAt`: long enough that a
   throwaway corporation made to squat a name is expensive in time,
3. is not serving a join cooldown (see Leaving, below), and
4. can pay the charter fee.

It files at the Conglomerate Affairs Bureau, which becomes a real action: "File a conglomerate charter".

**The charter fee** is `charterFee`, 100,000 credits: 40% of a new corporation's starting 250,000, and about a month
of an established corporation's profit (ECONOMY.md, one to two yards: 3,234 to 3,479 a day). It is a **sink**: it
leaves the economy, it does not go into the treasury. A second `charterDeposit`, 10,000 credits, goes into the new
conglomerate's treasury so that its first days of upkeep are paid.

**What the charter creates**: a conglomerate at level 1 (5 members) with the founding corporation as its founder and
only member, a treasury holding the deposit, and a record at the Bureau.

**Names.** The conglomerate name is checked by `validateCorporationName` exactly as a corporation name is: the same
length, characters, folding and reserved list. Two additions:

- The existing names it must not collide with are **every corporation's and every conglomerate's**. A conglomerate
  called "Kessler Ore Brokers" beside a corporation of that name is impersonation in mail and on the order book.
- Like a corporation's, a conglomerate's name is **never changed**. It is the trust signal on everything it signs.

**No free text beyond the name.** A charter has no description, motto or tag. The identity fields are chosen from
fixed lists: an **emblem** (one of `emblems`, 12 shapes) and a **colour** (one of `colours`, 10 of the design
system's tones). The name is validated text; everything else is a choice. This keeps the roster and the Overview free
of player prose. (Board Decision D-0.12-1, AB#707, has since allowed free-text *private messages*
(docs/design/messaging.md); it does not open charter text, and adding a motto later is one field, not a redesign.)

## Membership

**One conglomerate per corporation.** `corp.conglomerateId` holds at most one id. A corporation may hold several
invitations and one application at a time, but accepting one or being accepted withdraws the rest.

### The membership lifecycle

Each corporation's relation to one conglomerate is in exactly one state:

| State | Meaning | Reached by | Leaves by |
| --- | --- | --- | --- |
| `invited` | A founder or director has invited the corporation; it has not answered. | An invitation (the corporation is in no conglomerate, is not already invited, and is not in a join cooldown). | `member` (it accepts, and there is room), `declined` (it declines), `expired` (after `inviteExpiryDays`, 7), or `withdrawn` (the inviter's side takes it back). |
| `applied` | The corporation has asked to join; a founder or director has not answered. | An application (the corporation is in no conglomerate, has no other open application, and is not in a join cooldown). | `member` (accepted, and there is room), `declined`, `expired` (after `applicationExpiryDays`, 7), or `withdrawn` (the corporation takes it back). |
| `member` | The corporation belongs; `corp.conglomerateId` is set. | Accepting an invitation, or having an application accepted, while `memberCount < maxMembers`. | `left` or `removed`, or the conglomerate is dissolved. |
| `left` | The corporation chose to go. | Leave, by any member except the founder (the founder transfers the role or dissolves first). | Nothing: a new invitation or application starts a new relation, after the cooldown. |
| `removed` | A founder or director removed it. | Removal, by a role allowed to (see Roles). | Nothing, as `left`. |

`declined`, `expired` and `withdrawn` are the ends of an invitation or application that never became membership; they
are kept only in the history the Bureau shows, and they start no cooldown.

**Room.** An invitation or application can be made while the conglomerate is full; it can only be *accepted* when
`memberCount < maxMembers`. The accept action says so plainly when there is no room.

**Leaving and removal.** Either way, the corporation serves a **join cooldown** of `joinCooldownHours`, 24 hours,
before it can accept an invitation or apply anywhere. This stops a corporation hopping between conglomerates to
collect whatever each gives on joining. Nothing a member contributed to the treasury is returned: it was given, as
EVE's corporation wallet works, and the Overview says so before a member contributes.

**Dissolution.** Only the founder can dissolve a conglomerate, at the Bureau. Every member becomes independent with
no cooldown, the name is released after `nameReleaseDays` (30; so a dissolved name cannot be seized at once and used
to impersonate the old group), and the treasury is split equally among the corporations that were members at that
moment. A conglomerate whose last member leaves is dissolved the same way.

## Roles

Three fixed roles. The founder is one corporation; directors are at most `maxDirectors` (5); everyone else is a
member. A permission not in this table does not exist.

| Permission | Founder | Director | Member |
| --- | :-: | :-: | :-: |
| See the roster, the level, the treasury balance and its history | yes | yes | yes |
| Contribute credits to the treasury | yes | yes | yes |
| Leave | no (transfer the role or dissolve first) | yes | yes |
| Invite a corporation, or withdraw an invitation | yes | yes | no |
| Accept or decline an application | yes | yes | no |
| Remove a member | yes | yes | no |
| Remove a director | yes | no | no |
| Promote a member to director, or demote a director | yes | no | no |
| Spend the treasury on a level-up (at the Bureau) | yes | no | no |
| Choose the emblem and colour (from the fixed lists) | yes | no | no |
| Transfer the founder role to a director | yes | no | no |
| Dissolve the conglomerate (at the Bureau) | yes | no | no |

Why spending is the founder's alone: the treasury is other corporations' money, and the EVE lesson is that the power to
admit people and the power to take money must not sit in the same hands by default. Directors run the roster; the
founder, who paid the charter, answers for the money. If the founder is absent, the fix is the founder transferring
the role, not a director spending without it.

**An absent founder.** If the founder corporation has not signed in for `founderAbsentDays` (30), the longest-serving
director may claim the founder role at the Bureau. A conglomerate is never locked forever by one missing player.

## The treasury and upkeep

A conglomerate has one treasury, in credits. Members put money in; nothing takes money out except upkeep, level-ups
and dissolution. (Pooling *resources*, not credits, is the next plan line and is not designed here.)

**Upkeep** is charged daily from the treasury:

```text
upkeep per day = members × (upkeepBase + upkeepPerMemberStep × (members − 5))
               = members × (150 + 5 × (members − 5))
```

It is paid per member, and the per-member rate itself grows with size, so the total grows faster than headcount:

| members | per member per day | total per day |
| --: | --: | --: |
| 5 | 150 | 750 |
| 10 | 175 | 1,750 |
| 20 | 225 | 4,500 |
| 30 | 275 | 8,250 |
| 50 | 375 | 18,750 |
| 100 | 625 | 62,500 |

At 100 members each corporation's share is 625 a day, about a fifth of an established corporation's profit. That is
the point: holding a hundred corporations together should be a real, continuing cost, not a one-off purchase.

**Arrears.** If the treasury cannot pay a day's upkeep, the conglomerate is **in arrears**: no invitation or
application can be accepted and no level can be bought until the treasury is paid up. After `arrearsDropDays` (7)
days in arrears, the conglomerate drops one level: `maxMembers` falls, nobody is removed, and it cannot admit anyone
until it is below the new cap again. Arrears never remove a member or take money from a member's own corporation.

## The level ladder, 5 to 100 members

A level is room and nothing else (the WoW lesson): it raises `maxMembers`. It is bought by the founder at the Bureau,
from the treasury, and it has requirements so that a group grows into its room rather than buying room it does not
fill.

To buy the next level, **all** of:

1. the treasury pays the **cost**, and still holds `levelReserveDays` (7) days of upkeep at the current headcount
   afterwards,
2. the conglomerate is **full enough**: at least `levelFillPct` (80%) of the current cap, rounded up,
3. it has held its current level for the **minimum days** in the table, and
4. it is not in arrears.

| Level | maxMembers | Cost (credits) | Members needed to buy it | Days at the level before |
| --: | --: | --: | --: | --: |
| 1 | 5 | the charter (100,000 fee, 10,000 deposit) | — | — |
| 2 | 10 | 50,000 | 4 | 3 |
| 3 | 15 | 75,000 | 8 | 3 |
| 4 | 20 | 100,000 | 12 | 5 |
| 5 | 25 | 150,000 | 16 | 5 |
| 6 | 30 | 200,000 | 20 | 7 |
| 7 | 40 | 300,000 | 24 | 7 |
| 8 | 50 | 400,000 | 32 | 10 |
| 9 | 60 | 550,000 | 40 | 10 |
| 10 | 70 | 700,000 | 48 | 14 |
| 11 | 80 | 900,000 | 56 | 14 |
| 12 | 90 | 1,100,000 | 64 | 14 |
| 13 | 100 | 1,400,000 | 72 | 14 |

"Members needed" is 80% of the previous level's cap, rounded up. Reaching level 13 from a charter takes at least 106
days and 5,925,000 credits in level costs alone, before upkeep. Every level cost is a sink.

## T-018: why a bigger conglomerate is not always better

T-018 (learnings/TRANSFERABLE.md): a knob whose revenue and cost are both linear in the number the player sets has no
decision in it; the answer is always "max". The size of a conglomerate is such a knob, and the design gives it an
interior optimum in two ways:

1. **Upkeep per member rises with size** (150 at 5 members, 625 at 100). Whatever a member gains from being in a
   conglomerate, the price of that membership is higher in a bigger one.
2. **What a conglomerate buys together is shared, and the share falls with size only as long as there is something to
   share.** A co-owned asset's price divided by headcount falls as 1/n; the upkeep rises as n. Their sum has a minimum,
   and past it every extra member makes membership dearer for everybody. The dominance overlay (a later v0.12 line)
   must follow the same rule: a conglomerate's dominance in a system is *one* share, divided among its members, never a
   share each. That story is told so here; it is not designed here.

**Worked example.** Stated goal: *co-own one station costing 600,000 credits and keep it for 180 days* (co-owned
stations are a later v0.12 line; the price is a placeholder, and the arithmetic holds for any price). Each member's
cost over the 180 days is its share of the station plus 180 days of its upkeep, level costs left out:

| members | station share | upkeep, 180 days | each member pays |
| --: | --: | --: | --: |
| 10 | 60,000 | 31,500 | 91,500 |
| 20 | 30,000 | 40,500 | 70,500 |
| **30** | **20,000** | **49,500** | **69,500** |
| 40 | 15,000 | 58,500 | 73,500 |
| 50 | 12,000 | 67,500 | 79,500 |
| 100 | 6,000 | 112,500 | 118,500 |

For this goal, **30 members is the better choice than 100**: each corporation pays 69,500 instead of 118,500, and the
30-member group can reach that size 83 days sooner (level 6 after at least 23 days, level 13 after 106) and spends 575,000 credits on levels instead of
5,925,000. A hundred members is the better choice only for a goal that needs a hundred corporations' presence at once,
such as holding many systems in the dominance overlay, and that is what it should cost to do.

A second goal shows the small end: *share intel on 4 systems*. Four scouting corporations cover it; a fifth adds
nothing. At 5 members, each pays 150 a day; the same five inside a 50-member conglomerate pay 375 a day for the same
intel. Small wins.

## What the server stores (for the implementation stories)

A proposal for v0.12-02's shape; the field names the Overview reads are fixed, the rest are the Builder's to adjust:

```text
state.conglomerates[]: {
  id, name, emblem, colour, level, maxMembers, foundedAt,
  founder: <corporation publicId>,
  members: [ { corp: <publicId>, role: "founder" | "director" | "member", joinedAt } ],
  treasury: { credits, history: [ { at, kind, corp, amount } ] },
  invitations: [ { corp, by, at, state } ], applications: [ { corp, at, state } ],
  arrearsSince: <time> | null
}
account.corp.conglomerateId: <conglomerate id> | null
account.corp.joinCooldownUntil: <time> | null
```

Sent to every client: each conglomerate's public summary `{ id, name, emblem, colour, level, memberCount, maxMembers }`
(so the Overview card and an "apply" list work). Sent only to a conglomerate's own members: its roster, treasury and
invitations. Corporations are always named by `publicId`, never by account id (Bugs #711, #754).

## Every number this design introduces

Proposed keys under `conglomerates` in `data/economy.json`.

| Key | Value | What it is |
| --- | --: | --- |
| `minFounderAgeDays` | 7 | How old a corporation must be to found a conglomerate. |
| `charterFee` | 100,000 | The charter's price, a sink. |
| `charterDeposit` | 10,000 | Paid by the founder into the new treasury, for its first upkeep. |
| `emblems` | 12 | How many emblems the fixed list has. |
| `colours` | 10 | How many colours the fixed list has. |
| `inviteExpiryDays` | 7 | An unanswered invitation expires. |
| `applicationExpiryDays` | 7 | An unanswered application expires. |
| `joinCooldownHours` | 24 | After leaving or removal, before joining anywhere. |
| `nameReleaseDays` | 30 | After dissolution, before the name can be used again. |
| `maxDirectors` | 5 | Directors a conglomerate may have. |
| `founderAbsentDays` | 30 | Founder absence after which a director may claim the role. |
| `upkeepBase` | 150 | Upkeep per member per day at 5 members. |
| `upkeepPerMemberStep` | 5 | Added to each member's daily upkeep per member above 5. |
| `upkeepMinMembers` | 5 | The headcount the step counts from. |
| `arrearsDropDays` | 7 | Days in arrears before the conglomerate drops a level. |
| `levelReserveDays` | 7 | Days of upkeep the treasury must still hold after buying a level. |
| `levelFillPct` | 80 | How full the current level must be to buy the next. |
| `levels` | the 13 rows above | Each level's `maxMembers`, `cost` and `minDaysAtPrevious`. |
