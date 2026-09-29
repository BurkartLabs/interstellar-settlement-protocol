# AB#4811 (ISP-254 slice C1a): every changed string

The scope is the Conglomerate Bureau: membership, invitations and applications, roles, levels, charter and identity,
and dissolution. The treasury, hangar, shared intel and co-owned station are slice C1b. The approach is slice A's
(docs/ab-950/strings.md): the plain words stay, and a protocol line from public/scripts/protocol.js follows them. The
line is the guide's phrase, then the Conglomerate screen's code, `CGL-ADM-1`, which is aria-hidden. Three refusals
were also reworded to say what to do next (Bug #4814); they are last.

## Refusals (public/scripts/views/conglomerateBureau.js)

| Where | Old (unchanged plain words) | New: added after them |
|---|---|---|
| `act()`'s status line, for every Bureau request: charter, emblem and colour, apply, accept or decline an invitation, withdraw or answer an application, withdraw an invitation, invite, promote, demote, remove, transfer the founder role, leave, dissolve, buy a level | "{server message}" or "The Bureau refused that." | `DENIED // CGL-ADM-1`, or `UNFUNDED, BALANCE INSUFFICIENT // CGL-ADM-1` when the refusal's code is insufficient-credits |
| Charter form | "Give the conglomerate a name." | `DENIED // CGL-ADM-1` |
| Invite search | "Type part of a corporation's name." | `DENIED // CGL-ADM-1` |
| Invite search | "{server message}" or "The search did not answer." | `UNSUCCESSFUL // CGL-ADM-1` |

## Statuses (public/scripts/conglomerateBureau.js)

| Where | Old (unchanged) | New: added after it |
|---|---|---|
| An invitation received (independent corporation) | "Level n · n of n members · invited {time}" | `FILED, AWAITING REVIEW // CGL-ADM-1` |
| The corporation's own application | "Sent {time}. Its founder or a director answers it; it expires unanswered after 7 days." | `FILED, AWAITING REVIEW // CGL-ADM-1` |
| A member's applications waiting | "Applied {time}" | `FILED, AWAITING REVIEW // CGL-ADM-1` |
| A member's invitations sent | "Invited {time}" | `FILED, AWAITING REVIEW // CGL-ADM-1` |
| A join cooldown | "Your corporation left a conglomerate recently. It can accept an invitation or apply from {time}." | `SUSPENDED // CGL-ADM-1` |
| The directory could not be loaded | "{reason} Nothing has changed." | `UNSUCCESSFUL // CGL-ADM-1` |

Left without a line, as slice A left its availability hints:
- the pre-emptive reasons a charter or an application cannot be filed yet (a disabled button with its reason);
- roles (Founder, Director, Member) and "Yours", which are not statuses;
- the succession line;
- empty states.

## Notifications (server; title and body unchanged, a checked protocol added)

| File | Notification | Protocol |
|---|---|---|
| server/game/conglomerateRoles.js (`tell`) | "Promoted to director" / "Demoted to member" | Concluded |
| same | "Removed from a conglomerate" | Concluded |
| same | "You are now your conglomerate's founder" (transfer) | Concluded |
| same | "Conglomerate dissolved" | Concluded |
| server/game/membership.js | "You are now your conglomerate's founder" (succession) | Concluded |
| server/game/conglomerateLevels.js | "{name} reached level {n}" | Concluded |
| server/game/conglomerates.js | "{name} lost a level" (upkeep unpaid) | Lapsed |

All are on the Conglomerate screen (`CGL-ADM-1`).

## Reworded: the next step added (Bug #4814, ISP-6's rule)

| File | Old | New |
|---|---|---|
| server/game/conglomerates.js | "The charter costs {n} credits (a {fee} fee and a {deposit} deposit into the new treasury). Your corporation holds {m}." | "… Your corporation holds {m}. Sell goods or finish an assignment to raise the credits, then file." |
| server/game/conglomerateLevels.js | "{reason} The Bureau cannot sell this level just now." | "… The Bureau cannot sell this level just now. Try again later." |
| server/corporationName.js (the conglomerate branch only) | "A corporation or conglomerate already has this name." | "A corporation or conglomerate already has this name. Choose another name." |

Registration's own name-taken wording is unchanged: it is outside these groups.

## Also changed, not copy

- **public/scripts/apiClient.js:** a refused request's error keeps the server's `code` and `status`.
- **public/scripts/protocol.js:** `refusalMeaning` reads code `insufficient-credits` before the words. Slice A's
  callers pass words and are unchanged.
- **public/styles.css:** `.protocol-line` is inline-block, so it moves to the next line whole rather than breaking
  mid-phrase. It still wraps if it is wider than its box.

## Every framed error, read against ISP-6's rule (an error says what to do next)

**Pass.** Each says the step, or states it plainly enough to act on:
- **Emblem, colour and levels:** "Choose an emblem/a colour from the Bureau's…"; "Name the level to buy."; "Levels are
  bought one at a time: the next is level {n}."; "Level {n} needs: {requirements}"; "…Travel there, then buy it."
  (and "…then dissolve it.")
- **Invitations and applications:** "…Withdraw it before applying elsewhere."; "…Buy the next level at the Bureau, or
  wait for a place."; "The invitation stays open until it has room or expires."; "…until its treasury is paid up. A
  deposit that covers what is owed ends the arrears."; "…Try again after {time}." (the invitation limit);
  "…cannot join one until {time}." (join cooldown, with the time to wait for).
- **Roles and leaving:** "Demote one first."; "Promote the corporation first."; "Transfer the founder role to a
  director first, or dissolve…"; "To go, leave the conglomerate instead."; "Cancel it first, which returns every
  contribution, then dissolve."; "A member can be made a director or a member; the founder role moves only by
  transfer."
- **Charter:** "Leave it before you found another."; "Yours can from {time}."; "…Travel there, then file."; "…try again
  later."; the name rules ("must be 3 to 32 characters", "may use letters, digits…", "belongs to an institution in the
  game; choose another").

**Pass, the step is someone else's or there is nothing to do:**
- "Only the founder can …" and "Only the founder or a director can invite a corporation." (the refusal names who
  can); "The founder cannot be removed."
- "…is already level {n}."; "…is at the highest level."; "That corporation is already a {role}."; "That corporation
  already has an open invitation from this conglomerate."; "This invitation/application is {state}; it cannot be
  answered again."; "Your corporation is already in this conglomerate."

**Defensive, reached only by a stale or hand-made request.** Not reworded:
- "No such conglomerate / application / invitation / corporation."
- "That corporation is not a member of this conglomerate."
- "Account not found."

**Failed, reworded.** The three above (Bug #4814).
