// Bug AB#2313: the ports Chromium refuses to load outright (net::ERR_UNSAFE_PORT), from its kRestrictedPorts list
// (net/base/port_util.cc): the ones at 1024 and above that the Chromium Playwright runs (153) restricts, which are the
// only ones an operating system hands a server started on PORT 0, which is how most e2e specs start theirs. The server listened on 5061; Chromium would not open it, and the
// spec failed at page.goto. playwright.config.js allows these for the whole run with --explicitly-allowed-ports:
// they are restricted so a web page cannot talk to a real SIP, IRC, NFS or X11 service, and a test server on
// 127.0.0.1 is none of those. e2e/unsafe-port.spec.js checks, in the browser the specs run, that each one is
// refused without the flag and allowed with it, so a list that drifts from Chromium's fails there.
export const CHROMIUM_RESTRICTED_PORTS = Object.freeze([
  1719, // h323gatestat
  1720, // h323hostcall
  1723, // pptp
  2049, // nfs
  3659, // apple-sasl
  4045, // lockd
  5060, // sip
  5061, // sips
  6000, // X11
  6566, // sane-port
  6665, 6666, 6667, 6668, 6669, // irc
  6697, // ircs-u
  10080 // amanda
]);

/** The Chromium flag that lifts the restriction for these ports. */
export const ALLOW_RESTRICTED_PORTS_ARG = `--explicitly-allowed-ports=${CHROMIUM_RESTRICTED_PORTS.join(",")}`;
