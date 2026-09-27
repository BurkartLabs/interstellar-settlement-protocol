// public/scripts/itcDuty.js: what a sale withholds toward anti-dumping duty owed to the ITC (ISP-232, AB#927;
// docs/design/WARFARE.md), shared by the server's settlement (server/itcService.js withholdDuty) and the sale
// confirmation, so the net a trader is shown is the net it is paid. `duty` is the corporation's own corp.itcDuty.

/**
 * ISP-242 (AB#938; WARFARE.md, Enforcement 3): what a sale withholds toward Council debts (corp.councilDebts, oldest
 * first). They share the ITC's one withholding: together never more than `withholdPct` of `net`, the duty first. Returns
 * [{ ref, credits }], one per debt it reaches.
 */
export function councilWithholding(net, itcWithheld, debts, withholdPct) {
  let room = Math.floor((Math.max(0, Number(net) || 0) * (Number(withholdPct) || 0)) / 100) - Math.max(0, Number(itcWithheld) || 0);
  const out = [];
  for (const d of debts || []) {
    if (!(room > 0)) break;
    const x = Math.min(room, Math.floor(Number(d.owed) || 0));
    if (x > 0) { out.push({ ref: d.ref, credits: x }); room -= x; }
  }
  return out;
}

/** The credits withheld from a sale's `net` (after tax and tariff): withholdPct of it, at most what is owed. */
export function withheldFrom(net, duty) {
  const owed = Math.floor(Number(duty?.owed) || 0);
  if (!(owed > 0) || !(net > 0)) return 0;
  return Math.min(owed, Math.floor((net * (Number(duty.withholdPct) || 0)) / 100));
}
