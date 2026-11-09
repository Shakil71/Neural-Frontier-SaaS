# ADR-0007: An original design system

- Status: Accepted · 2026-11-09

## Decision

Neural Frontier has its own visual identity and does not imitate Microsoft 365 or any other product's
interface, icons, illustrations or layout signatures.

- **Brand mark**: a rising ridge of three connected nodes over a horizon arc ("neural frontier"), on an
  indigo→cyan gradient tile. Original SVG (`apps/web/src/components/brand/logo.tsx`).
- **Themes**: "Deep Space" (dark, default — deep navy surfaces) and "Daybreak" (light). Both first-class.
- **Colour**: semantic tokens only, defined in OKLCH so lightness steps are perceptually even. Indigo
  primary, cyan accent, plus success/warning/danger. Charts resolve the same tokens at render time.
- **Type**: Geist and Geist Mono (SIL OFL), tabular numerals for data.
- **Components**: Radix primitives for accessible behaviour, styled locally (shadcn-style ownership,
  no runtime theme library).
- **Motion**: short, purposeful (≤300 ms), disabled under `prefers-reduced-motion`.
- **Honesty rules**: no control without a working action; no hardcoded numbers shown as live data;
  every data view has loading, empty, error and permission-denied states.

Details: [design-system.md](../design/design-system.md).
