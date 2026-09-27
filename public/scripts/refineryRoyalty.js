// ISP-237 (AB#932): the royalty a run of another corporation's patented chain will pay, as the Refinery's start
// confirmation shows it (WARFARE.md, "Patents": the holder's rate x the run's outputs at their standing bids' base,
// charged when the run delivers). The outputs are the run's own (refineryOutput: batches and the refinery's tier), the
// arithmetic is patentRoyalty.js's, which the settlement uses too. Pure, so it loads in node.
import { refineryOutput } from "./refineryOutput.js";
import { chainRunRoyalty } from "./patentRoyalty.js";

const n = (v) => Math.round(Number(v) || 0).toLocaleString("en-US");
const day = (t) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); // "24 Oct 2026": no hyphen to break at

/**
 * The quote for `batches` of `chain` in a refinery at `tier` (output `multiplier`), under `patent` (a register row):
 * { royalty, value, outputs, rows } where `rows` are the confirmation's { label, value } lines.
 */
export function runRoyaltyQuote({ patent, chain, batches, tier = 1, multiplier = 1, basePrices = {} }) {
  const outputs = (chain?.outputs || []).map((o) => ({ item: o.item, quantity: refineryOutput(o.quantityPerCycle, batches, tier, multiplier) }));
  const { value, royalty } = chainRunRoyalty(outputs, patent.ratePct, basePrices);
  const rows = [
    { label: "Output", value: outputs.map((o) => `${n(o.quantity)} ${o.item}`).join(", ") },
    { label: "Patent", value: `${patent.holder}, in force until ${day(patent.endsAt)}` },
    { label: "Royalty", value: `${n(royalty)} credits: ${patent.ratePct}% of the output's ${n(value)} at the standing bid, charged when the run delivers` },
    { label: "If you cannot pay", value: "The run still delivers in full. What your credits do not cover is owed to the holder, and half of each later sale's proceeds goes toward it." }
  ];
  return { royalty, value, outputs, rows };
}
