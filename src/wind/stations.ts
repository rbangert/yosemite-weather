// High-elevation wind stations for the wind-transported-snow / loading component.
//
// These are FIXED station IDs (not the nearest-station resolver, which collapses
// the high country onto the valley station YYVC1 — no wind). All are served free
// by api.weather.gov at /stations/{id}/observations; no Synoptic needed.
//
// `snotelId` maps each station to the nearest SNOTEL SWE site (see snotel/client.ts)
// used for the snow-availability gate: transport only matters when there is recent
// loose snow to move. Empirical gust availability noted per station (2026-06).

/** Per-station severity thresholds for the gated 24h STI (units (m/s)³·h).
 *  Entry points for each band: None < light ≤ Light < moderate ≤ Moderate < intense ≤ Intense.
 *  Derived as p50/p75/p95 of nonzero cold 24h windows. */
export interface SeverityThresholds {
  light: number;
  moderate: number;
  intense: number;
}

// Fallback for under-sampled stations: a generic high-station scale.
export const DEFAULT_SEVERITY: SeverityThresholds = { light: 100, moderate: 1000, intense: 5000 };

export interface WindStation {
  /** NWS/api.weather.gov + Synoptic station identifier. */
  id: string;
  /** Display name. */
  name: string;
  /** Elevation in feet. */
  elevationFt: number;
  /** Nearest SNOTEL station id for the new-snow gate. */
  snotelId: string;
  /** Whether the station reports wind gusts. (NWS omits TUMC1 gusts; Synoptic has them.) */
  hasGust: boolean;
  /** Severity bins, calibrated from the measured winter 2025-26 archive. */
  severity: SeverityThresholds;
}

// severity bins calibrated by scripts/wind_calibrate_measured.py against the cached
// measured winter 2025-26 Synoptic archive (single season → provisional but real;
// re-run with a multi-year archive on the paid plan for sturdier percentiles).
export const WIND_STATIONS: WindStation[] = [
  { id: "VGNC1", name: "Vogelsang",         elevationFt: 10118, snotelId: "DAN", hasGust: true,  severity: { light: 112, moderate: 539, intense: 6204 } },
  { id: "WWRC1", name: "White Wolf",        elevationFt: 8038,  snotelId: "TUM", hasGust: true,  severity: { light: 19,  moderate: 82,   intense: 645 } },
  { id: "TUMC1", name: "Tuolumne Meadows",  elevationFt: 8654,  snotelId: "TUM", hasGust: true,  severity: DEFAULT_SEVERITY }, // under-sampled (12 windows) → default
  { id: "615SE", name: "Tioga Pass East",   elevationFt: 7413,  snotelId: "DAN", hasGust: true,  severity: { light: 17,  moderate: 1264, intense: 4061 } },
  { id: "SE708", name: "Lee Vining Canyon", elevationFt: 7196,  snotelId: "DAN", hasGust: true,  severity: { light: 42,  moderate: 134,  intense: 757 } },
];

export function getWindStation(id: string): WindStation | undefined {
  return WIND_STATIONS.find((s) => s.id === id);
}
