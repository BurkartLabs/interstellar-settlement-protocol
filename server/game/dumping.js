// server/game/dumping.js: the ITC's dumping rule (ISP-232, AB#927). ISP-233 (AB#928): the rule lives in
// public/scripts/dumping.js, so the Exchange's listing warning runs the same function as the watch.
export { assess, listingWarning, normalOf, watchDays } from "../../public/scripts/dumping.js";
