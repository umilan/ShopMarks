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

- Never write a raw color into a component. Prefer the semantic names (`--color-text`, `--color-surface`, `--color-price-down`, …), which ui.css builds from the palette; a palette step used directly (like the `--blk5p` fill on inputs) is fine for neutral fills.
- Light mode uses the black steps where dark mode uses the white ones (e.g. `--blk5p` hover becomes `--wht5p`).
- Where a color must be opaque (sticky rows that content scrolls under), mix palette values with `color-mix()` instead of using a translucent step.
- The only exceptions are the danger reds, since the palette has no red, and the per-item placeholder hue.
