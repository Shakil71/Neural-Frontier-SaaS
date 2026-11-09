# Neural Frontier design system

Tokens live in [`apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css). Components live in
`apps/web/src/components`. When a second application (Employee Workspace, Phase 6) needs them, they
move to a shared `packages/ui`.

## Colour tokens (semantic)

| Token                                                       | Use                                           |
| ----------------------------------------------------------- | --------------------------------------------- |
| `background`, `surface`, `surface-raised`, `surface-sunken` | Page, cards, popovers, inset wells            |
| `border`, `border-strong`                                   | Hairlines; inputs and emphasis                |
| `foreground`, `muted`, `subtle`                             | Primary text, secondary text, tertiary/labels |
| `primary` (indigo) + `primary-soft`                         | Actions, selection, focus ring                |
| `accent` (cyan) + `accent-soft`                             | Secondary highlight, SSO/integration markers  |
| `success`, `warning`, `danger` (+ `-soft`)                  | Status only — never decoration                |
| `chart-1…5`                                                 | Categorical data series, in order             |

Contrast against `surface`, computed from the OKLCH tokens (sRGB, WCAG 2.x formula, 2026-11-09):

| Token                              | Daybreak (light)    | Deep Space (dark)    |
| ---------------------------------- | ------------------- | -------------------- |
| `foreground`                       | 17.8 : 1            | 16.7 : 1             |
| `muted`                            | 6.8 : 1             | 8.2 : 1              |
| `subtle`                           | 4.9 : 1             | 5.2 : 1              |
| `primary` (text/links)             | 5.7 : 1             | 5.6 : 1              |
| white on `primary-solid` (buttons) | 5.6 : 1             | 5.0 : 1              |
| `success` / `warning` / `danger`   | 5.1 / 5.0 / 5.0 : 1 | 9.4 / 10.7 / 6.5 : 1 |

All meet WCAG 2.2 AA (4.5 : 1) for normal text. Filled buttons use `primary-solid`, which is darker than
`primary` in the dark theme so white labels stay readable. Re-measure whenever a token changes.

## Typography

Geist 400/500/600; Geist Mono for IDs, IPs, codes. Scale: 11 (labels, uppercase +0.14em) · 12.5 (meta) ·
13–13.5 (UI) · 14–15 (body, card titles) · 26 (page title, −0.02em) · 32 (KPI, tabular) · 44–54 (sign-in hero).

## Spacing, radius, elevation

4 px base grid. Radii: 6 (controls) · 10 (inputs/buttons) · 14 (cards) · 20 (hero tiles).
Elevation is a 1 px inner highlight plus a soft drop shadow (`shadow-card`, `shadow-pop`) — subtle in
light, nearly invisible in dark, where borders carry the structure.

## Layout

Sidebar 264 px (collapses to a drawer below 1024 px) · top bar 64 px with ⌘K command palette · content
max 1320 px. Grids: KPI row 1/2/4 columns; analytic rows 2:1.

## Interaction patterns

- **Command palette** (⌘K / Ctrl K): every entry is a real navigation or action.
- **Side sheet** for record detail; **dialog** for confirmations that need a reason.
- **Destructive actions** require a reason (stored in the audit log) and show the consequence first.
- **Optimistic concurrency** conflicts explain themselves and refresh the record.
- **Toasts** confirm completed mutations; errors show the API message and request ID.

## States (required on every data view)

Loading (skeletons matching final layout) · Empty (icon, one-line explanation, next step) ·
Error (message + request ID + retry) · Permission denied (names the missing permission).

## Accessibility (WCAG 2.2 AA)

Radix primitives (focus management, ARIA), visible `:focus-visible` ring, keyboard-operable table rows,
labelled charts (`role="img"` + description), status never conveyed by colour alone (badges carry text),
`prefers-reduced-motion` honoured, 24×24 px minimum targets.

## Motion

Fade-in 240 ms on content; sheet slide 260 ms; spring for the active navigation pill; slow aurora
backdrop (18 s). Nothing animates on data refresh.
