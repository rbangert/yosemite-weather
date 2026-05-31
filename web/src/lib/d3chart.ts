// Shared D3 charting primitives for the weather charts.
//
// Pure helpers (no DOM work on import) factored out of MeteogramD3 so every
// chart shares one visual language and one implementation. All drawing helpers
// take explicit scales/geometry so they work for any single- or multi-panel
// chart, not just the meteogram.

import * as d3 from 'd3';

// ── Palette (Dracula) ───────────────────────────────────────────────────────
export const DRACULA = {
  bg: '#282A36', currentLine: '#44475A', fg: '#F8F8F2', comment: '#6272A4',
  cyan: '#8BE9FD', green: '#50FA7B', orange: '#FFB86C', pink: '#FF79C6',
  purple: '#BD93F9', red: '#FF5555', yellow: '#F1FA8C',
} as const;

// Non-series chart colors (gridlines, shading, markers).
export const CHART = {
  grid: 'rgba(148,163,184,0.10)',
  night: 'rgba(20,21,33,0.55)',
  now: 'rgba(248,248,242,0.18)',
  hover: 'rgba(248,248,242,0.28)',
} as const;

// Rotating accent palette for multi-series charts (e.g. SWE water years).
export const ACCENTS = [
  DRACULA.cyan, DRACULA.pink, DRACULA.green, DRACULA.purple,
  DRACULA.orange, DRACULA.yellow, DRACULA.red,
] as const;

// ── Units ────────────────────────────────────────────────────────────────────
export type UnitSystem = 'imperial' | 'metric';

export const toC = (f: number | null): number | null => f === null ? null : Math.round((f - 32) * 5 / 9);
export const toKh = (m: number | null): number | null => m === null ? null : Math.round(m * 1.60934);
export const cardinal = (deg: number | null): string =>
  deg === null ? '' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];

export const currentUnitSystem = (): UnitSystem =>
  (localStorage.getItem('units') as UnitSystem) ?? 'imperial';

/** Subscribe to the global nav unit toggle (`unitschange` CustomEvent). */
export function onUnitsChange(cb: (sys: UnitSystem) => void): void {
  document.addEventListener('unitschange', e =>
    cb((e as CustomEvent<{ sys: UnitSystem }>).detail.sys));
}

// ── Geometry / path generators ────────────────────────────────────────────────
type Series = (number | null)[];

/** Half the pixel distance between adjacent time points (band/bar half-width). */
export function halfStep(x: d3.ScaleTime<number, number>, times: Date[]): number {
  if (times.length < 2) return 6;
  return (x(times[1]) - x(times[0])) / 2;
}

/** Smooth line path 'd' string for a value series.
 *  `times` is the x-domain values (Dates for the meteogram, day numbers for SWE).
 *  By default the line breaks at null gaps; pass `spanGaps` to connect across them
 *  (drops the null points and joins the remaining ones, like Chart.js `spanGaps`). */
export function linePath(arr: Series, x: any, times: any[], y: any, spanGaps = false): string | null {
  if (spanGaps) {
    const pts = times
      .map((t, i) => [x(t), arr[i]] as [number, number | null])
      .filter((p): p is [number, number] => p[1] != null);
    return d3.line<[number, number]>().x(p => p[0]).y(p => y(p[1])).curve(d3.curveMonotoneX)(pts);
  }
  return d3.line<number>()
    .defined((_, i) => arr[i] != null)
    .x((_, i) => x(times[i])).y((_, i) => y(arr[i]!))
    .curve(d3.curveMonotoneX)(arr as any);
}

/** Filled area from a baseline up to a value series. */
export function areaPath(arr: Series, x: any, times: any[], y: any, y0: number): string | null {
  return d3.area<number>()
    .defined((_, i) => arr[i] != null)
    .x((_, i) => x(times[i])).y0(y0).y1((_, i) => y(arr[i]!))
    .curve(d3.curveMonotoneX)(arr as any);
}

/** Filled band between two value series (e.g. wind→gust range). */
export function bandPath(lower: Series, upper: Series, x: any, times: any[], y: any): string | null {
  return d3.area<number>()
    .defined((_, i) => lower[i] != null && upper[i] != null)
    .x((_, i) => x(times[i])).y0((_, i) => y(lower[i]!)).y1((_, i) => y(upper[i]!))
    .curve(d3.curveMonotoneX)(lower as any);
}

// ── Drawing primitives ────────────────────────────────────────────────────────

/** Shade contiguous night runs (index pairs) behind a panel's plot area. */
export function drawNightBands(g: any, o: {
  x: any; times: Date[]; runs: [number, number][];
  top: number; bottom: number; minX: number; maxX: number; color?: string;
}): void {
  const half = halfStep(o.x, o.times);
  for (const [a, b] of o.runs) {
    const l = Math.max(o.minX, o.x(o.times[a]) - half);
    const r = Math.min(o.maxX, o.x(o.times[b]) + half);
    if (r > l) g.append('rect')
      .attr('x', l).attr('y', o.top).attr('width', r - l).attr('height', o.bottom - o.top)
      .attr('fill', o.color ?? CHART.night);
  }
}

/** Small uppercase panel title. */
export function panelTitle(g: any, label: string, x0: number): void {
  g.append('text').attr('x', x0).attr('y', 9)
    .attr('fill', DRACULA.comment).attr('font-size', 9).attr('letter-spacing', '0.05em')
    .text(label.toUpperCase());
}

/** Left value axis with faint full-width gridlines; returns the axis group. */
export function leftAxis(g: any, o: {
  y: any; fmt: (v: any) => string; color: string; ticks?: number; x0: number; innerWidth: number;
}): any {
  const ax = d3.axisLeft(o.y).ticks(o.ticks ?? 4).tickFormat(o.fmt as any).tickSize(-o.innerWidth);
  const gg = g.append('g').attr('transform', `translate(${o.x0},0)`).call(ax);
  gg.select('.domain').remove();
  gg.selectAll('.tick line').attr('stroke', CHART.grid);
  gg.selectAll('text').attr('fill', o.color).attr('font-size', 9);
  return gg;
}

/** Right value axis (no gridlines) for dual-axis charts. */
export function rightAxis(g: any, o: {
  y: any; fmt: (v: any) => string; color: string; ticks?: number; xRight: number;
}): any {
  const ax = d3.axisRight(o.y).ticks(o.ticks ?? 4).tickFormat(o.fmt as any).tickSize(0);
  const gg = g.append('g').attr('transform', `translate(${o.xRight},0)`).call(ax);
  gg.select('.domain').remove();
  gg.selectAll('text').attr('fill', o.color).attr('font-size', 9);
  return gg;
}

/** Horizontal dashed reference line + label (e.g. freezing, dry-air). */
export function refLine(g: any, o: {
  y: any; value: number; color: string; label: string; minX: number; maxX: number;
}): void {
  const [d0, d1] = o.y.domain();
  if (o.value < Math.min(d0, d1) || o.value > Math.max(d0, d1)) return;
  const py = o.y(o.value);
  g.append('line').attr('x1', o.minX).attr('x2', o.maxX).attr('y1', py).attr('y2', py)
    .attr('stroke', o.color).attr('stroke-dasharray', '2,3');
  g.append('text').attr('x', o.minX + 3).attr('y', py - 2)
    .attr('fill', o.color).attr('font-size', 9).text(o.label);
}

/** Dashed vertical "now" marker, if the current time is within range. */
export function nowLine(svg: any, o: { x: any; times: Date[]; top: number; bottom: number; color?: string }): void {
  const now = new Date();
  if (now < o.times[0] || now > o.times[o.times.length - 1]) return;
  const px = o.x(now);
  svg.append('line').attr('x1', px).attr('x2', px).attr('y1', o.top).attr('y2', o.bottom)
    .attr('stroke', o.color ?? CHART.now).attr('stroke-width', 1).attr('stroke-dasharray', '4,4');
}

/** Bottom time axis (defaults: a tick every 6h, "Sat 6 PM" format). */
export function timeAxis(svg: any, o: {
  x: any; yTop: number; color?: string; ticks?: any; format?: (d: any) => string;
}): void {
  const ax = d3.axisBottom(o.x)
    .ticks(o.ticks ?? d3.timeHour.every(6))
    .tickFormat((o.format ?? d3.timeFormat('%a %-I %p')) as any);
  const g = svg.append('g').attr('transform', `translate(0,${o.yTop})`).call(ax);
  g.select('.domain').remove();
  g.selectAll('.tick line').attr('stroke', CHART.grid);
  g.selectAll('text').attr('fill', o.color ?? DRACULA.comment).attr('font-size', 9);
}

// ── Cross-panel hover ─────────────────────────────────────────────────────────
export interface FocusSeries { top: number; y: any; color: string; data: Series; }

/**
 * Attach a shared hover overlay: a vertical guide line, focus dots on each
 * series, and `onHover(i, px)` for the caller to render a tooltip. Spans the
 * full plot height so a single overlay drives every stacked panel.
 */
export function attachHover(svg: any, o: {
  x: any; times: any[]; minX: number; maxX: number; plotBottom: number;
  focus: FocusSeries[]; onHover: (i: number, px: number) => void; onLeave: () => void;
}): void {
  const hoverLine = svg.append('line').attr('y1', 0).attr('y2', o.plotBottom)
    .attr('stroke', CHART.hover).attr('stroke-width', 1).style('display', 'none');
  const dotsG = svg.append('g').style('display', 'none');

  svg.append('rect').attr('x', o.minX).attr('y', 0)
    .attr('width', o.maxX - o.minX).attr('height', o.plotBottom)
    .attr('fill', 'none').style('pointer-events', 'all')
    .on('mousemove', (event: MouseEvent) => {
      const [mx] = d3.pointer(event);
      const i = Math.max(0, Math.min(o.times.length - 1, d3.bisectCenter(o.times, o.x.invert(mx))));
      const px = o.x(o.times[i]);
      hoverLine.attr('x1', px).attr('x2', px).style('display', null);
      const active = o.focus.filter(f => f.data[i] != null);
      dotsG.style('display', null).selectAll('circle').data(active).join('circle')
        .attr('cx', px).attr('cy', (d: FocusSeries) => d.top + d.y(d.data[i]!))
        .attr('r', 2.5).attr('fill', (d: FocusSeries) => d.color);
      o.onHover(i, px);
    })
    .on('mouseleave', () => {
      hoverLine.style('display', 'none');
      dotsG.style('display', 'none');
      o.onLeave();
    });
}
