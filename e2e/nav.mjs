// ISP-75 (AB#764): open a tab the way a player does. The navigation is six groups (public/scripts/navGroups.js): on a
// desktop every tab is in sight; on a phone only the open group's tabs are, in the row above the bar, and a group with
// one tab has no row, because its button opens it. So: press the tab if it can be seen, else its group's button, then
// the tab if that brought it into sight. Specs call this rather than clicking a tab by its selector.

/** Open `tab` (a panel id such as "station") from the navigation. */
export async function openTab(page, tab) {
  const button = page.locator(`.nav-tab[data-tab="${tab}"]`);
  if (!(await button.isVisible())) {
    await page.locator(`.nav-group:has(.nav-tab[data-tab="${tab}"]) > .nav-group__button`).click();
  }
  if (await button.isVisible()) await button.click();
}
