// AB#4880: display styles. The game's own look is the default; each other style is one stylesheet,
// public/themes/<id>.css, whose every rule is scoped to html[data-theme="<id>"] and which changes how the game looks and
// is laid out, never what it says (docs/design/DISPLAY_STYLES.md). The choice is this browser's preference, kept in
// localStorage like the account id; nothing about it goes to the server.
//
// A classic script, loaded blocking in <head> right after styles.css, so a saved style's sheet is written into the
// document before the first paint (a stylesheet a script appends later does not block rendering, and the page would
// flash the default look first). After that, switching appends the new sheet, waits for it, then flips the attribute:
// no reload, and no frame drawn with half a style.
(function () {
  "use strict";

  var THEMES = [
    { id: "constructivist", name: "Constructivist Directive", group: "Round 1" },
    { id: "phosphor", name: "Phosphor Terminal", group: "Round 1" },
    { id: "deco", name: "Stellar Deco", group: "Round 1" },
    { id: "blueprint-blue", name: "Blueprint (Blue)", group: "Round 1" },
    { id: "blueprint-graphite", name: "Blueprint (Graphite)", group: "Round 1" },
    { id: "zaibatsu", name: "Zaibatsu", group: "Round 1" },
    { id: "monolith", name: "Monolith", group: "Round 2" },
    { id: "annual-report", name: "Annual Report", group: "Round 2" },
    { id: "deep-glass", name: "Deep Glass", group: "Round 2" },
    { id: "command-control", name: "Command & Control", group: "Round 2" },
    { id: "gazette", name: "Settlement Gazette", group: "Round 2" },
    { id: "bearer", name: "Bearer Instrument", group: "Round 2" },
    { id: "megaproject", name: "Megaproject", group: "Round 2" },
    { id: "director", name: "Director", group: "Round 2" },
    { id: "keynote", name: "Keynote", group: "Round 2" },
    { id: "lightline", name: "Lightline", group: "Round 2" }
  ];
  var KEY = "isp.displayStyle";
  var FONTS = "/themes/fonts.css";
  var root = document.documentElement;

  function known(id) {
    for (var i = 0; i < THEMES.length; i += 1) if (THEMES[i].id === id) return true;
    return false;
  }
  function saved() {
    try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; }
  }
  function remember(id) {
    try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
  }
  function sheet(id) {
    return document.querySelector('link[data-display-style="' + id + '"]');
  }
  function addSheet(href, attr, value) {
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute(attr, value);
    document.head.appendChild(link);
    return link;
  }

  // Before the first paint: write the saved style's sheets into <head> as the parser reaches this script.
  var start = saved();
  if (known(start)) {
    root.setAttribute("data-theme", start);
    if (document.readyState === "loading") {
      document.write('<link rel="stylesheet" href="' + FONTS + '" data-display-style-fonts="">' +
        '<link rel="stylesheet" href="/themes/' + start + '.css" data-display-style="' + start + '">');
    } else {
      addSheet(FONTS, "data-display-style-fonts", "");
      addSheet("/themes/" + start + ".css", "data-display-style", start);
    }
  } else if (start) {
    remember("");
  }

  // The game's page loads styles.css after this script, from scripts/appStyles.js (Bug #4839), so it would land after a
  // style's sheets and its equal-specificity rules would win. When it arrives, move the style's sheets after it again.
  function keepLast() {
    var mine = document.querySelectorAll("link[data-display-style-fonts], link[data-display-style]");
    for (var i = 0; i < mine.length; i += 1) document.head.appendChild(mine[i]);
  }
  if (window.MutationObserver) {
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i += 1) {
        for (var j = 0; j < records[i].addedNodes.length; j += 1) {
          var n = records[i].addedNodes[j];
          if (n.tagName === "LINK" && /(^|\/)styles\.css$/.test(n.getAttribute("href") || "")) keepLast();
        }
      }
    }).observe(document.head, { childList: true });
  }

  function current() {
    return root.getAttribute("data-theme") || "";
  }

  /** Switch to `id` ("" is the game's own look): load its sheet if it is not loaded, then flip the attribute. */
  function apply(id) {
    id = known(id) ? id : "";
    var done = function () {
      if (id) root.setAttribute("data-theme", id); else root.removeAttribute("data-theme");
      remember(id);
      document.dispatchEvent(new CustomEvent("isp:display-style", { detail: { id: id } }));
    };
    if (!id) return done();
    if (!document.querySelector("link[data-display-style-fonts]")) addSheet(FONTS, "data-display-style-fonts", "");
    var link = sheet(id);
    if (link && link.sheet) return done();
    if (!link) link = addSheet("/themes/" + id + ".css", "data-display-style", id);
    link.addEventListener("load", done, { once: true });
    link.addEventListener("error", done, { once: true });
  }

  /** The picker in the game's header: the game's own look first, then the styles by round. */
  function wire() {
    var select = document.getElementById("display-style-select");
    if (!select || select.options.length) return;
    var own = document.createElement("option");
    own.value = "";
    own.textContent = "Current (default)";
    select.appendChild(own);
    var groups = {};
    THEMES.forEach(function (t) {
      if (!groups[t.group]) {
        groups[t.group] = document.createElement("optgroup");
        groups[t.group].label = t.group;
        select.appendChild(groups[t.group]);
      }
      var o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.name;
      groups[t.group].appendChild(o);
    });
    select.value = current();
    select.addEventListener("change", function () { apply(select.value); });
    document.addEventListener("isp:display-style", function (e) { select.value = e.detail.id; });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  window.ispDisplayStyles = { list: THEMES.slice(), current: current, apply: apply };
})();
