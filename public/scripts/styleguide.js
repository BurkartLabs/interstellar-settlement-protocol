// ISP-72 (AB#761), ISP-73 (AB#762): the component style guide at /styleguide. The tabs, tooltips and toasts work as
// they will in the game.
import { initTabs, initToasts, initTooltips } from "./uiComponents.js";
import { loadSectionCodes } from "./sectionCodes.js"; // ISP-248 (AB#944): the headers read their codes from the registry

initTabs();
initTooltips();
initToasts();
loadSectionCodes();
