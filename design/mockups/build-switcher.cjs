// Bundle every mockup into one self-contained style switcher: design/mockups/style-switcher.html.
// Each design is embedded as a string and rendered into its own srcdoc iframe the first time it is picked,
// then kept alive, so switching back is instant and nothing is ever fetched or reloaded.
// Usage: node design/mockups/build-switcher.cjs
const fs = require('fs'), path = require('path');
const dir = __dirname;

const groups = [
  { label: 'Round 1 — originals', dir: '.', match: f => /^0\d-/.test(f) && !/-v2/.test(f) },
  { label: 'Round 1 — revisions (v2)', dir: '.', match: f => /^0\d-.*-v2/.test(f) },
  { label: 'Other session — 11 to 35', dir: '.', match: f => /^[1-3]\d-/.test(f) },
  { label: 'Round 2', dir: 'round2', match: () => true },
  { label: 'Archive', dir: 'archive', match: () => true },
  { label: 'Trash', dir: 'trash', match: () => true },
];

const designs = [];
for (const g of groups) {
  const files = fs.readdirSync(path.join(dir, g.dir)).filter(f => f.endsWith('.html') && g.match(f)).sort();
  for (const f of files) {
    const html = fs.readFileSync(path.join(dir, g.dir, f), 'utf8');
    const t = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
    const title = (t || f).replace(/\s+/g, ' ').trim()
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const id = (g.dir === '.' ? '' : g.dir + '/') + f.replace(/\.html$/, '');
    designs.push({ id, file: (g.dir === '.' ? '' : g.dir + '/') + f, group: g.label, title, html });
  }
}

// Embed as a JS literal; "<\/" keeps any "</script>" inside a design from closing ours.
const data = JSON.stringify(designs).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ISP Style Switcher</title>
<style>
  :root { --bar: 44px; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #0b0b0c; overflow: hidden; }
  #bar {
    position: fixed; inset: 0 0 auto 0; height: var(--bar); z-index: 10;
    display: flex; align-items: center; gap: 8px; padding: 0 12px;
    background: #111; border-bottom: 1px solid #2a2a2a;
    font: 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; color: #ddd;
  }
  #bar b { font-weight: 600; color: #fff; white-space: nowrap; }
  #bar select {
    flex: 0 1 460px; min-width: 0; height: 30px; padding: 0 8px;
    background: #1b1b1d; color: #fff; border: 1px solid #3a3a3d; border-radius: 6px; font: inherit;
  }
  #bar button {
    height: 30px; min-width: 32px; padding: 0 10px; border-radius: 6px; cursor: pointer;
    background: #1b1b1d; color: #fff; border: 1px solid #3a3a3d; font: inherit;
  }
  #bar button:hover, #bar select:hover { border-color: #666; }
  #count { color: #888; white-space: nowrap; }
  #hint { margin-left: auto; color: #777; white-space: nowrap; }
  #stage { position: fixed; inset: var(--bar) 0 0 0; }
  #stage iframe {
    position: absolute; inset: 0; width: 100%; height: 100%; border: 0;
    visibility: hidden; background: #0b0b0c;
  }
  #stage iframe.on { visibility: visible; }
  /* Parked designs are display:none so their animations stop; they were laid out at full size first. */
  #stage iframe.parked { display: none; }
  @media (max-width: 700px) { #hint, #bar b { display: none; } }
</style>
</head>
<body>
<div id="bar">
  <b>ISP styles</b>
  <button id="prev" title="Previous (Alt+←)">‹</button>
  <select id="pick" aria-label="Choose a design"></select>
  <button id="next" title="Next (Alt+→)">›</button>
  <span id="count"></span>
  <span id="hint">Alt+← / Alt+→ to cycle</span>
</div>
<div id="stage"></div>
<script>
const DESIGNS = ${data};
const pick = document.getElementById('pick'), stage = document.getElementById('stage');
const frames = {}; let current = null;

// Build the dropdown, grouped.
let og = null, lastGroup = null;
DESIGNS.forEach((d, i) => {
  if (d.group !== lastGroup) { og = document.createElement('optgroup'); og.label = d.group; pick.appendChild(og); lastGroup = d.group; }
  const o = document.createElement('option'); o.value = d.id; o.textContent = d.title; og.appendChild(o);
});

function frameFor(d) {
  if (frames[d.id]) return frames[d.id];
  const f = document.createElement('iframe');
  f.title = d.title;
  f.srcdoc = d.html;
  f.addEventListener('load', () => { hookLinks(f); if (f !== current) f.classList.add('parked'); });
  stage.appendChild(f);
  return (frames[d.id] = f);
}

// Links between mockups (e.g. the Zaibatsu pages) switch designs instead of navigating.
function hookLinks(f) {
  try {
    f.contentDocument.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      const hit = DESIGNS.find(d => href === d.file || href.endsWith('/' + d.file) || href === d.file.split('/').pop());
      if (hit) { e.preventDefault(); show(hit.id); }
      else if (!href.startsWith('#') && !href.startsWith('javascript')) e.preventDefault();
    }, true);
  } catch (_) {}
}

function show(id) {
  const d = DESIGNS.find(x => x.id === id) || DESIGNS[0];
  const f = frameFor(d);
  if (current && current !== f) { current.classList.remove('on'); current.classList.add('parked'); }
  f.classList.remove('parked'); f.classList.add('on'); current = f;
  pick.value = d.id;
  document.title = d.title + ' — ISP Style Switcher';
  document.getElementById('count').textContent = (DESIGNS.indexOf(d) + 1) + ' / ' + DESIGNS.length;
  if (location.hash.slice(1) !== d.id) history.replaceState(null, '', '#' + d.id);
  try { localStorage.setItem('isp-style', d.id); } catch (_) {}
  try { f.contentWindow.focus(); } catch (_) {}
}

function step(n) {
  const i = DESIGNS.findIndex(d => d.id === pick.value);
  show(DESIGNS[(i + n + DESIGNS.length) % DESIGNS.length].id);
}

pick.addEventListener('change', () => show(pick.value));
document.getElementById('prev').onclick = () => step(-1);
document.getElementById('next').onclick = () => step(1);
function keys(e) {
  if (!e.altKey) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
}
window.addEventListener('keydown', keys);
// Also catch Alt+arrows while focus is inside a design.
const bindKeys = f => { try { f.contentWindow.addEventListener('keydown', keys); } catch (_) {} };
new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.tagName === 'IFRAME' && n.addEventListener('load', () => bindKeys(n))))).observe(stage, { childList: true });
window.addEventListener('hashchange', () => show(location.hash.slice(1)));

let start = location.hash.slice(1);
if (!start) { try { start = localStorage.getItem('isp-style'); } catch (_) {} }
show(start || DESIGNS[0].id);

// Pre-render the rest in the background, one at a time, so later switches are instant.
const queue = DESIGNS.filter(d => !frames[d.id]);
(function warm() {
  const d = queue.shift(); if (!d) return;
  if (frames[d.id]) return warm();
  const f = frameFor(d);
  const next = () => (window.requestIdleCallback || setTimeout)(warm, { timeout: 400 });
  f.addEventListener('load', next, { once: true });
})();
</script>
</body>
</html>
`;

const out = path.join(dir, 'style-switcher.html');
fs.writeFileSync(out, page);
console.log(`wrote ${out}: ${designs.length} designs, ${(page.length / 1048576).toFixed(1)} MB`);
for (const g of groups) console.log('  ' + g.label + ': ' + designs.filter(d => d.group === g.label).length);
