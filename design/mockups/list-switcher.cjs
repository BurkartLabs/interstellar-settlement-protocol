// Print the style switcher's dropdown: groups and titles, as the browser shows them.
const { chromium } = require('playwright');
const path = require('path'), { pathToFileURL } = require('url');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto(pathToFileURL(path.join(__dirname, 'style-switcher.html')).href);
  const rows = await p.$$eval('#pick optgroup', gs => gs.map(g => '== ' + g.label + '\n' + [...g.children].map(o => '  ' + o.textContent).join('\n')));
  console.log(rows.join('\n')); await b.close();
})();
