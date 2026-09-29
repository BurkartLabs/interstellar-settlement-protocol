# Display styles (AB#4880)

The Board has not chosen a visual direction for ISP. To choose on the real game rather than on mockups, the game can
wear any of sixteen **display styles**, picked from the **Style** select in the game's header. The game's own look,
everything in `public/styles.css`, is the default and is untouched when no style is chosen.

The sixteen come from the Board's redesign round of 2026-09-27 (the mockups under `design/mockups/`, not committed):
Round 1 v2 (Constructivist, Phosphor Terminal, Stellar Deco, Blueprint Blue, Blueprint Graphite, Zaibatsu) and Round 2
(Monolith, Annual Report, Deep Glass, Command & Control, Settlement Gazette, Bearer Instrument, Megaproject, Director,
Keynote, Lightline). The mockups' **content** is invented; only their **style and structure** carry over.

## How it works

- `public/scripts/displayStyles.js` holds the list of styles, applies the saved one before the first paint (a classic
  script in `<head>` of every page, right after `styles.css`), and wires `#display-style-select`. The choice is this
  browser's (`localStorage["isp.displayStyle"]`); nothing goes to the server.
- A chosen style sets `data-theme="<id>"` on `<html>` and loads two stylesheets: `public/themes/fonts.css` (every
  style's `@font-face`, self-hosted under `public/vendor/fonts/` because the CSP allows fonts from `'self'` only; a face
  downloads only when a rule uses it) and `public/themes/<id>.css`.
- Switching appends the new sheet, waits for it to load, then flips the attribute. No reload.
- `scripts/vendor-theme-fonts.mjs` rebuilds the fonts and `fonts.css`. `scripts/look-display-styles.mjs [id ...]`
  seeds a corporation and shoots every style's main screens (see "Looking at a style").

## The rules for a style sheet

A style changes **how the game looks and is laid out, never what it says**.

1. **One file**, `public/themes/<id>.css`. Nothing else changes for a style: no HTML, no JavaScript, no class the markup
   does not already have.
2. **Every selector is scoped**: `:root[data-theme="<id>"]` for tokens, `[data-theme="<id>"] <selector>` for rules.
   Nothing may leak into another style or into the default look.
3. **No content.** `content:` only as `""` (a decorative box, rule or shape). No words, numbers, labels, glyphs or
   Han/Kanji characters, however decorative. No element that holds text or a control may be hidden (`display: none`,
   `visibility: hidden`, `opacity: 0`, clipped off screen, or covered). `text-transform` is fine; it is style.
4. **Structure is allowed**: grid and flex layout, where the navigation sits (top bar, side rail, bottom dock), order,
   sizes, spacing, borders, shapes (`clip-path`), backgrounds, textures, shadows, motion. A decorative layer
   (`#starfield-canvas`, `.app-bg`, a `::before`/`::after` with `content: ""`) may be hidden or replaced.
5. **Tokens first.** Override the design tokens (the `:root` block at the top of `public/styles.css`: surfaces, text,
   accent, status colours, fonts, sizes, spacing, radii) before writing component rules; most of a style is its tokens.
   Status keeps its meaning: `--danger` is still bad news, `--success` good, `--warn` caution.
6. **Readable.** Text meets WCAG AA (4.5:1) on its surface; body text no smaller than the default's; panels are solid
   enough that nothing behind them competes with text. No flicker; motion only under `prefers-reduced-motion:
   no-preference`.
7. **Phones still work.** At 767px and below the shell is a bottom bar of group buttons with the open group's tabs above
   it (`public/styles.css`, "App shell"); a style may restyle it but must keep it working. Put desktop-only layout (a
   top rail, a right rail, a dock) under `@media (min-width: 768px)`. No sideways scroll at any width.
8. **Fonts** only from `public/themes/fonts.css` (the families listed there), with a generic fallback. Images only as
   CSS gradients or `data:` SVG (the CSP allows `'self'` and `data:`).

## The parts of the game a style works on

| Part | Selectors |
|---|---|
| Page | `body`, `#game-shell`, `#starfield-canvas`, `.app-bg` |
| Header | `.app-header`, `__brand`, `__overline`, `__title`, `__actions`, `__notifications`, `__panel`, `__style` |
| Layout | `.layout-grid` (grid areas `nav`, `side`, `main`), `.main-panel`, `.side-panel`, `.side-panel__block`, `__toggle` |
| Navigation | `.app-nav`, `.nav-group` (`.is-open`, `.is-collapsed`), `.nav-group__button`, `.nav-group__tabs`, `.nav-tab` (`.active`), `.nav-count` |
| Screens | `.tab-panel.ui-screen` (`.active`), `.ui-screen__header`, `__title`, `__lede`, `__meta`, `.ui-code` (a section code such as CORP-OPS-1) |
| Panels, cards | `.ui-panel` (`__header`, `__title`, `__meta`, `__actions`, `__body`), `.ui-card` (`__title`, `__body`, `__meta`) |
| Figures | `.kpi-strip`, `.kpi-tile` (`--primary`), `__label`, `__value`, `__sub`; `.ui-kv` (a `dl`) |
| Controls | `.ui-button` (`--primary`, `--secondary`, `--ghost`, `--danger`), `.ui-select`, `.ui-input`, `.ui-tabs`/`[role=tab]` |
| Data | `.ui-table`, `.ui-badge` (`--warn`, …), `.ui-list`, `.ui-grid`, `.ui-stack`, progress bars |
| Before play | `.landing` (`__intro`, `__hero`, …), `.auth-page`, `.ui-field` |

Read the "App shell", "Core components" and "Data components" sections of `public/styles.css` before overriding them:
a style's rule must out-rank the base rule it replaces (the `[data-theme]` prefix adds one attribute of specificity).

## Looking at a style

```bash
node scripts/look-display-styles.mjs <id>
```

It writes `e2e/screenshots/ab-4880/<id>/` (Overview, Station, Galactic Exchange, Financial Core, Corporate R&D at
1440x900; Overview and the Exchange at 390x844) and `findings.json` there: sideways scroll and the shared screen findings,
and `hidden`, any text that is in sight in the default look and gone in the style (it must be empty). Look at the
pictures; the findings are what the pictures cannot tell you, not a substitute for them.
