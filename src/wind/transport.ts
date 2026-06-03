// Snow Transport Index + drift-direction math for the wind-loading component.
//
// Blowing-snow mass flux scales ~cubically with wind speed above a mobilization
// threshold, so we use  STI = Σ max(0, U - U_t)³ · Δt  rather than raw "wind run"
// (which is linear and can't tell a steady breeze from a transport-grade storm).
// Direction follows the Fryberger drift-potential method: bin each observation's
// transport by the DOWNWIND (lee) direction and vector-sum to a resultant.
//
// Calibrated against ERA5 winter 2025-26 at VGNC1 (see scripts/wind_transport_*.py):
// the cubic index, the directional vector, and the snow-availability gate all
// behaved sensibly (gate suppressed 47/480 high-wind-but-dry windows). Absolute
// severity thresholds are PROVISIONAL pending a season of measured station data.

const MPH_TO_MS = 0.44704;

/** Transport threshold for fresh cold snow (~13.4 mph). */
export const DEFAULT_THRESHOLD_MS = 6.0;
/** Above this temperature (°F) the surface is too warm/wet to transport. */
export const DEFAULT_COLD_F = 34;

export const COMPASS16 = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;
export type Compass = (typeof COMPASS16)[number];

export type Severity = "None" | "Light" | "Moderate" | "Intense";

export interface WindObs {
  observedAt: string;            // ISO timestamp
  windSpeedMph: number | null;
  windGustMph: number | null;
  windDirectionDeg: number | null; // degrees the wind blows FROM
  airTempF: number | null;
}

/** Severity band entry points for the gated 24h STI (m/s³·h). */
export interface SeverityThresholds {
  light: number;
  moderate: number;
  intense: number;
}

/** Fallback bins when a station has no calibrated thresholds. */
export const DEFAULT_SEVERITY: SeverityThresholds = { light: 100, moderate: 1000, intense: 5000 };

export interface LoadingOptions {
  /** Mobilization threshold in m/s (default 6). */
  thresholdMs?: number;
  /** Cold-surface cutoff in °F (default 34). */
  coldF?: number;
  /** Whether transportable (recent, loose) snow exists in the area. */
  snowAvailable: boolean;
  /** Per-station severity bins (defaults to DEFAULT_SEVERITY). */
  thresholds?: SeverityThresholds;
}

export interface LoadingResult {
  obsCount: number;
  windowHours: number;
  peakSustainedMph: number;
  peakGustMph: number;
  /** Raw transport index, ignoring snow availability. */
  sti: number;
  /** Transport index after the cold + snow-availability gate. */
  stiGated: number;
  /** Resultant lee-loading direction (deg, downwind) or null if no transport. */
  leeDirectionDeg: number | null;
  /** Compass label for leeDirectionDeg. */
  leeDirection: Compass | null;
  /** Directional focus: |resultant| / total, 0..1 (1 = single aspect). */
  focus: number;
  /** Per-compass-bin gated transport contribution (the drift rose). */
  rose: Record<Compass, number>;
  /** True when the snow + cold gate let transport through. */
  gateOpen: boolean;
  severity: Severity;
}

export function degToCompass(deg: number): Compass {
  const i = Math.round(((deg % 360) / 22.5)) % 16;
  return COMPASS16[(i + 16) % 16];
}

/** Per-hour transport flux contribution for an effective wind speed (m/s). */
export function transportFlux(speedMs: number, thresholdMs = DEFAULT_THRESHOLD_MS): number {
  const excess = speedMs - thresholdMs;
  return excess > 0 ? excess ** 3 : 0;
}

/**
 * Map a gated 24h STI to a severity band using per-station bins (p50/p75/p95 of
 * nonzero cold windows). Calibrated from the measured winter 2025-26 archive; see
 * scripts/wind_calibrate_measured.py and WIND_STATIONS[].severity.
 */
export function classifySeverity(
  stiGated: number,
  thresholds: SeverityThresholds = DEFAULT_SEVERITY
): Severity {
  if (stiGated < thresholds.light) return "None";
  if (stiGated < thresholds.moderate) return "Light";
  if (stiGated < thresholds.intense) return "Moderate";
  return "Intense";
}

const emptyRose = (): Record<Compass, number> =>
  Object.fromEntries(COMPASS16.map((c) => [c, 0])) as Record<Compass, number>;

/**
 * Compute the Snow Transport Index, drift rose, and resultant lee direction over
 * a window of observations. `obs` need not be sorted. Gusts are preferred over
 * sustained speed (they do disproportionate transport); when a station reports no
 * gust the sustained speed is used.
 */
export function computeWindLoading(obs: WindObs[], opts: LoadingOptions): LoadingResult {
  const thresholdMs = opts.thresholdMs ?? DEFAULT_THRESHOLD_MS;
  const coldF = opts.coldF ?? DEFAULT_COLD_F;

  const rows = [...obs].sort((a, b) => a.observedAt.localeCompare(b.observedAt));

  let sti = 0;
  let stiGated = 0;
  let vx = 0; // east component of gated drift vector
  let vy = 0; // north component
  let peakSustainedMph = 0;
  let peakGustMph = 0;
  let gateOpen = false;
  const rose = emptyRose();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.windSpeedMph != null) peakSustainedMph = Math.max(peakSustainedMph, r.windSpeedMph);
    if (r.windGustMph != null) peakGustMph = Math.max(peakGustMph, r.windGustMph);

    if (r.windSpeedMph == null || r.windDirectionDeg == null) continue;

    // Time weight = gap to previous obs, clamped so a long data gap can't dominate.
    let dtH = 1;
    if (i > 0) {
      const gap =
        (Date.parse(r.observedAt) - Date.parse(rows[i - 1].observedAt)) / 3_600_000;
      dtH = Math.min(2, Math.max(0, gap));
    }

    const effMph = r.windGustMph ?? r.windSpeedMph;
    const w = transportFlux(effMph * MPH_TO_MS, thresholdMs) * dtH;
    sti += w;
    if (w <= 0) continue;

    // Gate: transport only counts when loose snow exists AND the surface is cold.
    const coldEnough = r.airTempF == null || r.airTempF <= coldF;
    if (opts.snowAvailable && coldEnough) {
      gateOpen = true;
      stiGated += w;
      const toRad = (((r.windDirectionDeg + 180) % 360) * Math.PI) / 180; // downwind = lee
      vx += w * Math.sin(toRad);
      vy += w * Math.cos(toRad);
      rose[degToCompass((r.windDirectionDeg + 180) % 360)] += w;
    }
  }

  const resultant = Math.hypot(vx, vy);
  const leeDirectionDeg =
    resultant > 0 ? (((Math.atan2(vx, vy) * 180) / Math.PI) + 360) % 360 : null;

  const windowHours =
    rows.length > 1
      ? (Date.parse(rows[rows.length - 1].observedAt) - Date.parse(rows[0].observedAt)) /
        3_600_000
      : 0;

  return {
    obsCount: rows.length,
    windowHours: Math.round(windowHours * 10) / 10,
    peakSustainedMph: Math.round(peakSustainedMph),
    peakGustMph: Math.round(peakGustMph),
    sti: Math.round(sti),
    stiGated: Math.round(stiGated),
    leeDirectionDeg: leeDirectionDeg == null ? null : Math.round(leeDirectionDeg),
    leeDirection: leeDirectionDeg == null ? null : degToCompass(leeDirectionDeg),
    focus: stiGated > 0 ? Math.round((resultant / stiGated) * 100) / 100 : 0,
    rose,
    gateOpen,
    severity: classifySeverity(stiGated, opts.thresholds),
  };
}
