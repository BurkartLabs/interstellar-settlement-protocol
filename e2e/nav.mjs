// ISP-75 (AB#764): open a tab the way a player does. The navigation is six groups (public/scripts/navGroups.js): on a
// desktop every tab is in sight; on a phone only the open group's tabs are, in the row above the bar, and a group with
// one tab has no row, because its button opens it. So: press the tab if it can be seen, else its group's button, then
// the tab if that brought it into sight. Specs call this rather than clicking a tab by its selector.

/** Open `tab` (a panel id such as "station") from the navigation. */
export async function openTab(page, tab) {
  // AB#2472: the game drawn first. Since AB#2481 a group's name toggles on a desktop, so pressing it while the shell is
  // still hidden could collapse the group it meant to open, when an earlier choice had it expanded.
  await page.locator("#logout-btn").waitFor({ state: "visible", timeout: 20_000 });
  const button = page.locator(`.nav-tab[data-tab="${tab}"]`);
  if (!(await button.isVisible())) {
    await page.locator(`.nav-group:has(.nav-tab[data-tab="${tab}"]) > .nav-group__button`).click();
  }
  if (await button.isVisible()) await button.click();
}

/** AB#2472: open one of the Galactic Exchange's subpages: "standing" (the default), "players", "mine", "mercs" or "history". */
export async function openExchangePage(page, id) {
  await openTab(page, "market");
  await page.locator(`#exchange-tab-${id}`).click();
}
