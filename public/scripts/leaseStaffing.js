// How many employees the ISA wants on payroll before it files a mining lease (AB#1202). The one copy of the rule: the
// server's lease route refuses with it, the claims office quotes it, and the walkthrough's hire step waits for it.
// tests/unit/leaseStaffing.test.js checks every lease milestone against it.

export const EMPLOYEES_PER_LEASE = 5;

/** Employees needed on payroll to file one more lease, for a corporation already holding `heldLeaseCount`. */
export function employeesForNextLease(heldLeaseCount) {
  const held = Number.isFinite(heldLeaseCount) && heldLeaseCount > 0 ? Math.floor(heldLeaseCount) : 0;
  return (held + 1) * EMPLOYEES_PER_LEASE;
}
