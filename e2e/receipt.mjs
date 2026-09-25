// AB#743: after a committing action (rent, renew, hire, file a lease, commission a yard, start a cycle) the game shows
// what it did in #action-receipt-modal. A click outside the card goes through it, but the card can sit over the next
// control, so a script that plays on does what a player does: read it and press Escape.
import { expect } from "@playwright/test";

export async function acknowledgeReceipt(page) {
  const modal = page.locator("#action-receipt-modal");
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
}
