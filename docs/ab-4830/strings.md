# AB#4830 (ISP-255 slice c1): every changed string

The scope is Comms: chat, conversations, the Inbox's memoranda (compose, send, drafts) and the Forums. The approach is
slices A, C1a and Bd's: the plain words stay, and a protocol line from public/scripts/protocol.js (unchanged) follows
them. The line is the guide's phrase, then the screen's code, which is aria-hidden: CORP-COM-1 Chat, CORP-COM-2 Forums,
CORP-COM-3 Inbox.

The count from AB#4825's split was 81 sites (41 server, 40 client). Nothing in Comms sends a notification or a system
letter of its own (the two letters in the Inbox, the welcome and the probe return, are already protocol documents). So
every server string reaches the player through a client status line or the Command Log. The line is drawn there, and the
server's words are unchanged apart from Bug #4832's three rewrites.

**How a refusal's meaning is read** (public/scripts/commsProtocol.js): from the server's own status and code, the
pattern of Bugs #4807, #4814, #4820 and #4822. A refusal is DENIED (or UNFUNDED, protocol.js's rule). A request the
server could not act on (a 5xx, or chat's `store-unavailable`) or that never got an answer is UNSUCCESSFUL: nothing was
decided about it. Chat's three refusals now carry a code (`line-too-long`, `rate-limited`, `store-unavailable`), since
a socket refusal has no status.

## Chat (CORP-COM-1)

| Where | Plain words (unchanged) | Added after them |
|---|---|---|
| A line refused, Command Log (app.js `chat:refused`) | "A chat line is at most 300 characters." | `DENIED // CORP-COM-1` |
| same | "That is more than {n} lines in {s} seconds. Try again in {t} seconds." | `DENIED // CORP-COM-1` |
| same | "Chat is unavailable right now. Try again in a minute." | `UNSUCCESSFUL // CORP-COM-1` |
| Older history not read (views/comms.js) | "Chat history is unavailable right now. Try again in a minute." (server/routes/chat.js) | `UNSUCCESSFUL // CORP-COM-1` |
| same, a refusal | "No such chat channel." / "That page marker is not valid." (chatHistory.js) | `DENIED // CORP-COM-1` |

## Conversations (the Inbox's Players tab, CORP-COM-3)

| Where | Plain words (unchanged) | Added after them |
|---|---|---|
| A send refused, in a thread or from Compose (views/conversations.js) | the server's words (server/game/conversations.js: "A message needs a body.", "A message is at most {n} characters.", "Say which corporation the message is for, by its id.", "No corporation has that id.", "Sender not found.") or "The message was not sent." | `DENIED // CORP-COM-3` |
| same, the store could not take it | "Messages cannot be sent right now. Nothing was sent; try again shortly." / "The message store is unavailable. Try again shortly." | `UNSUCCESSFUL // CORP-COM-3` |

## The Inbox's memoranda (views/inbox.js, CORP-COM-3)

| Where | Plain words | Added after them |
|---|---|---|
| Compose, no body | "Write a message first." | `DENIED` |
| Compose, recipient not placed | "Say which corporation the message is for." / "No corporation has that name. Check the spelling: part of a name lists every corporation it matches." (**Bug #4832**, was "No corporation has that name.") / "{n} corporations match that name. Choose which one you mean." | `DENIED` |
| Compose, the directory search failed | "{server words}" or "The corporation directory could not be searched." | `UNSUCCESSFUL` for a 5xx, else `DENIED` |
| Compose, send refused | the conversation send's words (above) | `DENIED` or `UNSUCCESSFUL` |
| Compose, send never answered | "The message was not sent: {reason}. Check your connection and press Send again." (**Bug #4832**, was "Error: {reason}") | `UNSUCCESSFUL` |
| Draft saved | "Draft saved." | `CONCLUDED` |
| Draft not saved | "{server words}" or "The draft was not saved. Press Save Draft again." (was "Failed to save draft.") | `DENIED` or `UNSUCCESSFUL` |
| Draft not saved, never answered | "The draft was not saved: {reason}. Check your connection and press Save Draft again." (**Bug #4832**) | `UNSUCCESSFUL` |
| Draft deleted | "Draft deleted." | `WITHDRAWN` |
| Draft not deleted | "The draft was not deleted: {server words, or: the server did not answer. Try again in a minute}." (**Bug #4832**, the fallback was "the server refused") | `DENIED` or `UNSUCCESSFUL` |

## The Forums (views/forums.js, CORP-COM-2)

| Where | Plain words (unchanged) | Added after them |
|---|---|---|
| Like, signed out | "Sign in to like posts." | `DENIED` |
| Like refused | "Like failed: {server words}" ("Thread not found.", "Reply not found.", the account limit) | `DENIED`, or `UNSUCCESSFUL` for a 5xx |
| Reply, empty | "Reply cannot be empty." | `DENIED` |
| Reply posted, beyond the loaded page | "Reply posted. It is at the end of the thread: load more replies to see it." | `CONCLUDED` |
| Reply refused | "Failed to post reply: {server words}" ("Reply content is required.", "That reply is not in this thread.", "Thread not found.", the hourly limit) | `DENIED` or `UNSUCCESSFUL` |
| New thread, a field empty | "Category, title, and body are all required." | `DENIED` |
| New thread refused | "Failed to post thread: {server words}" ("category, title, and body are required.", "Unknown forum category.", the hourly limit) | `DENIED` or `UNSUCCESSFUL` |
| A thread not loaded | "This thread could not be loaded: {reason}" (forumPages.js) | `UNSUCCESSFUL` |
| The list not loaded | "The threads could not be loaded: {reason}" | `UNSUCCESSFUL` |

## Every framed error, read against ISP-6 (an error says what to do next)

Each server message above, with the line the player sees it on, reads as either a next step ("Try again in a minute",
"Choose which one you mean", "Check your connection and press Send again") or a plain fact whose next step is the control
in front of the player: an empty body is filled, and an over-long line is shortened. Three did not, and are **Bug #4832**
(fixed first, in its own commit): an unknown recipient, a send or save that never reached the server, and a delete
refused without words. The rest were left as they are, because the page never shows them:
- messaging routes' "Account not found." / "Sender not found." (only a session for an account that is gone);
- "Message not found." / "Invalid folder or message not found." (mark-read and move ignore a failure on the page);
- "That is not a corporation name." and "Recipient corporation is required." (the page always sends a string, and the
  page's own check comes first);
- "That page marker is not valid." (the page only sends the cursors the server gave it).

## Left without a line

- In-flight words: "Sending…", "Saving…", "Deleting…", "Loading the thread…", "Loading threads…", "Loading older
  messages…", "Loading…".
- Empty states and positions: "No conversations yet…", "No replies yet…", "No threads in this category yet.", the
  Inbox's empty folders, "Start of the channel", "Scroll up for older messages", "Showing {n} of {m} replies".
- "Addressed to {corporation}. Press Send.", which is a hint and not a status.

## The looks (1280x800, this branch's server with low limits, e2e/comms-protocol.spec.js)

1. `1-chat-refused.png`: a third chat line in ten seconds, refused by the server: its words, then `DENIED // CORP-COM-1`.
2. `2-compose-refused.png`: Compose to a name nothing matches: Bug #4832's next step, then `DENIED // CORP-COM-3`.
3. `3-draft-saved.png`: "Draft saved. CONCLUDED // CORP-COM-3".
4. `4-reply-refused.png`: a second forum reply inside the hour: the server's limit words, then `DENIED // CORP-COM-2`.
5. `5-command-log.png`: "Draft deleted. WITHDRAWN // CORP-COM-3" above the chat refusal.
