# Design

Visual system for BeMySEO Review. Tokens are defined in `src/brand.js` (set as
CSS variables at runtime via `App.jsx`) with fallbacks in `src/index.css`.

## Color

Palette derived from bemyseo.com. Strategy: **Restrained** — deep navy chrome,
one vivid-blue action color, green reserved for "approved", amber for "changes".

| Role | Token | Hex | Use |
|------|-------|-----|-----|
| Brand / action | `--brand` | `#1362FC` | Primary buttons, links, focus, progress, selection |
| Brand hover | `--brand-dk` | `#0B4FD6` | Hover/active of brand actions |
| Accent | `--accent` | `#1362FC` | Progress fill, focus ring, markers (same blue) |
| Chrome | `--nav` | `#141B2E` | Top bars / app shell (deep BeMySEO navy) |
| Chrome dark | `--nav-dk` | `#0E1422` | Chrome gradients / hovers |
| Ink | `--ink` | `#161A22` | Body text |
| Slate | `--slate` | `#5C6470` | Muted text, secondary labels |
| Line | `--line` | `#E1E7F0` | Borders, dividers (cool) |
| Paper | `--paper` | `#F6F8FC` | App background (cool off-white) |
| Approved | `--ok` | `#0C9648` | Approved state; AA on white + on `--okbg` |
| Changes | `--warn` | `#B5701A` | Changes-requested state; AA on white + `--warnbg` |

Semantic tints (index.css only): `--okbg #E3F5EA`, `--warnbg #FBEFD8`,
`--mist #EAEFF8` (cool blue-gray for code, chips, client tag).

Contrast verified: brand blue + white ≈ 5:1; `--ok`/`--warn` pass ≥3:1 both as
text on their tint and as white text on the solid fill.

## Typography

One family — system sans stack (`--fb`), no display/body pairing (product
register). Fixed rem scale, weights 400/600/700 carry the hierarchy. Headings
use `text-wrap: balance`.

## Components

- **Buttons:** `.btn.brand` (solid blue), `.btn.lite` (white + cool border). One shape, ~10px radius.
- **Badges:** pill, uppercase, status-tinted (approved/changes/pending). Always paired with the status word.
- **Status dots:** 10px circle echoing badge color in dense lists.
- **Cards:** white on paper, 12–16px radius, cool low shadow (`--shadow`). No nested cards.
- **Bars:** deep navy chrome, light text, brand-blue progress.

## Motion

150–250ms ease-out on state transitions. The only choreography is the client
thank-you checkmark pop and section reveal flash — both with reduced-motion
fallbacks. No page-load sequences.

## Shadow & Radius

`--r 12px`, `--r-lg 16px`. `--shadow: 0 12px 32px -18px rgba(19,40,80,.45)` —
cool, soft, single layer (no ghost-card border+shadow pairing).
