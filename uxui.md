# Saver — UX/UI guidelines

Rules to follow whenever the popup or the dashboard UI changes.

## Spacing and sizes

All spacing and sizes come from one scale, built on an 8px base:

| Value | Use |
|---|---|
| 2px | Hairline gaps, e.g. between stacked list rows |
| 4px | Tight gaps, small radii |
| **8px** | **Default** — reach for this first |
| 16px | Padding inside rows and panels, gaps between groups |
| 24px | Outer padding of large areas |
| 32px | Small controls (compact buttons) |
| 40px | Standard controls (inputs, selects, icon buttons) |
| 64px | Large separations, e.g. bottom padding of a page |

- Pick the nearest value from the scale; don't invent in-between ones like 6px, 12px or 20px.
- This covers padding, margin, gap, width, height and border radius. Borders (1px) and font sizes are outside the scale.
- Layout widths and heights (sidebar, dialog, popup, card image, columns) may be any multiple of 8, e.g. 96, 240, 480.

## Colors

Every color comes from this palette, defined at the top of [ui.css](extension/src/ui.css):

| Variable | Value |
|---|---|
| `--wht5p` | `rgba(255,255,255,0.05)` |
| `--wht10p` | `rgba(255,255,255,0.1)` |
| `--wht50p` | `rgba(255,255,255,0.5)` |
| `--wht100p` | `rgba(255,255,255,1)` |
| `--blk5p` | `rgba(0,0,0,0.05)` |
| `--blk10p` | `rgba(0,0,0,0.1)` |
| `--blk50p` | `rgba(0,0,0,0.5)` |
| `--blk100p` | `rgba(0,0,0,1)` |
| `--acc10p` | `rgba(25,100,50,0.1)` |
| `--acc50p` | `rgba(25,100,50,0.5)` |
| `--acc100p` | `rgb(25,100,50)` |

- Components use only the semantic names (`--color-text`, `--color-surface`, `--color-price-down`, …), never a palette step or a raw color. ui.css defines each one as `light-dark(light value, dark value)`, so a palette step used directly would not switch with the theme.
- Dark mode is light mode with `blk` and `wht` swapped: every semantic color that uses `--blk*p` in light mode uses the matching `--wht*p` in dark mode, and the other way round (e.g. the field fill `--blk5p` becomes `--wht5p`, the white surface becomes black).
- Exceptions: the accent is lightened in dark mode so it stays readable on black; the dialog backdrop and shadows stay black; text on the colored placeholder tile stays white.
- Deliberate exceptions that look the same in both themes: the note stripe drawn over product images, and the logo (`--acc100p` tile, `--wht100p` bookmark).
- Where a color must be opaque (sticky rows that content scrolls under), mix palette values with `color-mix()` instead of using a translucent step.
- The only exceptions are the danger reds, since the palette has no red, and the per-item placeholder hue.

## Interaction states

Every control reacts the same way. Inputs and buttons have no visible border, in any state; hover, press and open only darken the fill one step each. Keyboard focus shows the focus outline.

| Control rests on | Hover | Press / open |
|---|---|---|
| Nothing (plain: ghost buttons, desktop sort, mobile top-bar controls) | `--blk5p` | `--blk10p` |
| White (regular buttons, list rows, menu items) | `--blk5p` | `--blk10p` |
| `--color-field` (fields, top-bar icon buttons) | `--blk10p` | `--blk10p` |

- Dark mode uses white and starts one step higher, since 5% barely shows on black: element fills rest at `--wht10p`, and hover / press go to 20% white (mixed from `--wht100p`, as the palette has no step between 10 and 50).
- Keep the 1px transparent border so controls stay the same size as bordered elements. The selected state (current list) uses the accent tint, not a gray step.
- Exceptions with their own colors: primary buttons (accent shades), danger buttons (red), price changes (`--color-price-*-hover`), and cards, which lift with a shadow instead of changing fill.
