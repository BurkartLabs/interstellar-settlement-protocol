// What a client receives of state that every player shares (Bugs #1134, #1145, #1171).
//
// The forums and the market's order book are stored with account ids: a post's authorAccountId, the likedBy list that
// keeps likes to one per account, a listing's sellerAccountId that cancel and the listing limit check. Those ids stay on
// the server, as mail's do (Bug #711). A client is sent names, counts, and whether a post or listing is its own.
// A listing's stationId, where its goods came from, stays on the server too: cancel returns them there, and nothing on
// the page shows it, so sent it only told anyone where each seller was docked (Bug #1171).

/** The name shown when a corporation has none. Never the email address. */
export const UNNAMED_CORPORATION = "Unregistered corporation";

// Posts and listings made before names were required could be signed with the account's email address.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A stored author or seller name as other players may see it. */
export function publicName(name) {
  const trimmed = String(name ?? "").trim();
  return !trimmed || EMAIL.test(trimmed) ? UNNAMED_CORPORATION : trimmed;
}

/** A thread or reply as `viewer` (an account id, or null signed out) should see it. */
export function postView(post, viewer = null) {
  if (!post || typeof post !== "object") return post;
  const { authorAccountId, likedBy, ...rest } = post;
  const likers = Array.isArray(likedBy) ? likedBy : [];
  return { ...rest, author: publicName(rest.author), likes: likers.length, likedByMe: Boolean(viewer) && likers.includes(viewer) };
}

/** A thread and its replies as `viewer` should see them. */
export function threadView(thread, viewer = null) {
  if (!thread || typeof thread !== "object") return thread;
  const view = postView(thread, viewer);
  view.replies = Array.isArray(thread.replies) ? thread.replies.map((reply) => postView(reply, viewer)) : [];
  return view;
}

/** The forums as `viewer` should see them. */
export function forumsView(forums, viewer = null) {
  if (!forums || typeof forums !== "object") return forums;
  const threads = Array.isArray(forums.threads) ? forums.threads : [];
  return { ...forums, threads: threads.map((thread) => threadView(thread, viewer)) };
}

/** A market order as `viewer` should see it: the seller's name, and whether it is the viewer's own. No account id or station. */
export function orderView(order, viewer = null) {
  if (!order || typeof order !== "object") return order;
  const { sellerAccountId, stationId, ...rest } = order;
  const view = { ...rest, mine: Boolean(viewer) && Boolean(sellerAccountId) && sellerAccountId === viewer };
  if ("seller" in rest) view.seller = publicName(rest.seller);
  return view;
}
