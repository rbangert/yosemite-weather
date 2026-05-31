# Roadmap: Migrate charting from Chart.js to D3

## Why

The hourly **Meteogram** was rebuilt from scratch in D3 (`web/src/components/MeteogramD3.astro`)
and proved that D3 gives us things Chart.js makes awkward:

- **Pixel-aligned stacked panels** — all five graphs share one `scaleTime` x-axis in a single SVG,
  so gridlines, the "now" line, and day/night bands line up exactly across panels.
- **One unified cross-panel hover** — a single overlay drives one vertical guide, focus dots on
  every series, and one tooltip that aggregates all values for the hovered hour. With Chart.js this
  needed five charts wired together by hand.
- **Full control** — reference lines (freezing / dry-air), in-SVG wind-direction arrows, day/night
  shading, and custom axes are straightforward draw calls instead of plugin gymnastics.
- **Dependency hygiene** — standardizing on one charting lib (D3, tree-shakeable) lets us drop
  `chart.js` entirely.

This roadmap migrates the **remaining** Chart.js charts to D3, then removes Chart.js.

## Current state

- ✅ **Done** — `MeteogramD3.astro` (D3): the 5-panel hourly meteogram, shipped as the "Meteogram D3"
  tab alongside the Chart.js "Meteogram" for comparison.
- ⛔️ **Still on Chart.js** (the migration targets):

| File | Lines | Role | Where used |
|---|---:|---|---|
| `components/Meteogram.astro` | ~567 | Chart.js 5-panel meteogram (superseded by `MeteogramD3`) | `ForecastTabs` → "Meteogram" tab |
| `components/HourlyGraph.astro` | ~538 | Condensed 4-panel hourly graph (superseded by the meteogram) | `ForecastTabs` → "Hourly" tab |
| `components/ForecastChart.astro` | ~160 | Temp + precip dual-axis chart | `/:slug` location detail page |
| `components/SWEChart.astro` | ~243 | Multi-year water-year SWE line chart | `SWECard` / `/snowpack` |
| `pages/data.astro` | ~497 | Data-explorer panels for every DB variable | `/data` |

`chart.js` is a dependency in `web/package.json`; removing the above lets us delete it.

## Strategy

Extract the reusable D3 plumbing already written inside `MeteogramD3.astro` into a small shared
module, then port each remaining chart on top of it. Retire the superseded components rather than
porting them 1:1.

### Phase 0 — Extract a shared D3 charting module

Create `web/src/lib/d3chart.ts` (pure helpers, no DOM-on-import) factoring out what `MeteogramD3`
already does inline, so every chart shares one implementation and one visual language:

- `DRACULA` color tokens + grid/night/now/hover colors.
- `nightRuns(forecast, lat, lon)` — already computed server-side; move the logic here so it's shared.
- `drawNightBands(g, x, runs, …)`, `drawNowLine(svg, x, …)`.
- `panelStack(host, panels[])` — lays out stacked SVG panels sharing one x-scale, returns per-panel
  groups + y-scales (the core of the meteogram architecture).
- `attachHover(svg, x, times, series[], renderTooltip)` — the cross-panel guide + focus dots + tooltip.
- `unitHelpers` — `toC`, `toKh`, `cardinal`, and a `unitschange` subscription helper.
- Axis helpers — `leftAxis(g, y, fmt, color)`, `timeAxis(svg, x, …)`.

Then refactor `MeteogramD3.astro` to consume the module (no behavior change). **Acceptance:**
`bun run check` clean; meteogram visually identical; no console errors.

### Phase 1 — `ForecastChart` → D3 (location detail page)

`/:slug` currently renders the small temp+precip `ForecastChart`. Two options:

1. **Replace** it with `MeteogramD3` (richer, already built) — preferred if we want the detail page to
   match the area pages. Needs `lat`/`lon` passed to the page (available in config).
2. **Port** the dual-axis temp+precip chart to a small D3 component using the Phase-0 helpers — if we
   want to keep the detail page lightweight.

Recommend (1); fall back to (2). **Acceptance:** detail page renders the chart, unit toggle works,
no console errors, screenshot.

### Phase 2 — `SWEChart` → D3 (snowpack)

Port the multi-year water-year SWE comparison to D3: N line series (one per water year, rotating the
Dracula accent palette already used), a month-based x-axis (Oct→Sep), a legend, and the shared hover.
This is the most genuinely "new" port (multi-series + legend) and the best test of the Phase-0 module
beyond the meteogram. **Acceptance:** all water-year lines render with correct colors/legend; hover
reads the right year/value; `/snowpack` + `SWECard` compact mode both work; screenshots.

### Phase 3 — `data.astro` explorer → D3

The data explorer renders ~Chart.js panels for every DB variable. Port to a small reusable
`<D3Panel>` built on the Phase-0 helpers and loop over the variable set. Lower priority
(diagnostic page). **Acceptance:** every variable panel renders; no console errors.

### Phase 4 — Retire superseded Chart.js components

Once the D3 meteogram is the canonical hourly view:

- In `ForecastTabs.astro`, drop the **"Hourly"** and **"Meteogram"** (Chart.js) tabs; keep the D3
  meteogram and rename its tab to **"Hourly"** (or "Meteogram").
- Delete `HourlyGraph.astro` and `Meteogram.astro`.
- Remove the now-unused `ft-hourly-activate` / `ft-meteogram-activate` wiring.

**Acceptance:** the area pages show 7-Day + the single D3 hourly tab; no dead imports; `bun run check`
clean; no regressions on the three areas.

### Phase 5 — Drop the dependency + docs

- `cd web && bun remove chart.js`.
- Grep the repo for any lingering `chart.js` imports (should be none).
- Update `README.md`: component list, charting section, and roadmap items.

**Acceptance:** `chart.js` absent from `web/package.json` and lockfile; `bun run build` succeeds;
all chart pages verified in the browser.

## Sequencing & risk

- Order: **0 → 2 → 1 → 3 → 4 → 5.** Do Phase 2 (SWE multi-series) right after the extraction to
  battle-test the shared module on a chart shape unlike the meteogram before porting the rest.
- Phase 4 (retiring Chart.js components) must come before Phase 5 (removing the dep).
- Each phase is independently shippable and reversible; commit per phase.

### Things to watch

- **SSR**: charts are client-only (`<script>` islands). Keep all D3 DOM work inside the activation
  handler; the module must be import-safe (no top-level DOM access).
- **Responsiveness**: the meteogram re-renders on a debounced `resize`; reuse that. Consider a
  `ResizeObserver` in the shared module so every chart gets it for free.
- **Unit toggle**: keep the single `unitschange` event contract from `Layout.astro`; the shared
  module should expose one subscription helper so every chart stays in sync.
- **Accessibility**: SVG charts need `role="img"` + a text summary / `<title>`; add as part of Phase 0
  so all charts inherit it. (Chart.js canvas had none either — net improvement.)
- **Tests**: there are no frontend chart tests today; at minimum verify each phase with `bun run check`
  + a browser pass (preview tools) + screenshot, as we did for the meteogram.

## Definition of done

- No `chart.js` import anywhere in `web/`; dependency removed.
- One shared D3 charting module powers the meteogram, the detail chart, SWE, and the data explorer.
- All chart surfaces verified: type-check clean, no console errors, unit toggle works, screenshots.
