// Bug #4798: one mailbox, one account. me+1@example.com and me+2@example.com are two addresses but one inbox, so each
// verified as a new corporation with the full starter grant, free credits for a main account. Registration compares
// this key instead of the address; the address is still stored and mailed as typed, and login is unchanged.
//
// The key: lowercased; a +tag dropped from the local part on every domain (plus addressing is near universal and a
// real address that differs only by a +tag is not worth an exploit); and, for Gmail only, the dots in the local part,
// which Gmail ignores. Other providers' dot rules vary, so their dots stay.
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** The mailbox an address delivers to, as far as registration can tell; "" for something that is not an address. */
export function mailboxKey(email) {
  if (typeof email !== "string") return "";
  const address = email.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at < 1) return address;
  let local = address.slice(0, at);
  let domain = address.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (GMAIL_DOMAINS.has(domain)) local = local.replace(/\./g, "") || local;
  return `${local}@${domain}`;
}
