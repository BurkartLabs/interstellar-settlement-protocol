// public/scripts/itcDuty.js: what a sale withholds toward anti-dumping duty owed to the ITC (ISP-232, AB#927;
// docs/design/WARFARE.md), shared by the server's settlement (server/itcService.js withholdDuty) and the sale
// confirmation, so the net a trader is shown is the net it is paid. `duty` is the corporation's own corp.itcDuty.

/** The credits withheld from a sale's `net` (after tax and tariff): withholdPct of it, at most what is owed. */
export function withheldFrom(net, duty) {
  const owed = Math.floor(Number(duty?.owed) || 0);
  if (!(owed > 0) || !(net > 0)) return 0;
  return Math.min(owed, Math.floor((net * (Number(duty.withholdPct) || 0)) / 100));
}
