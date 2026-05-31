import { config } from "../config";

// Client for the National Avalanche Center public API
// (https://api.avalanche.org/v2/public). No auth, no documented rate limits.
// We normalize the deeply-nested NAC product into a flat shape the rest of the
// app can store and render without re-parsing NAC's structure.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// Fetch JSON with exponential backoff on transient failures. Mirrors the
// behavior of src/nws/client.ts's nwsFetch, kept local to avoid coupling.
async function avyFetch(url: string): Promise<any> {
  const { retryMaxAttempts, retryBaseDelayMs } = config;

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.ok) return res.json();

      if (!RETRYABLE_STATUS.has(res.status) || attempt >= retryMaxAttempts) {
        throw new Error(`Avalanche API error ${res.status} ${res.statusText} for ${url}`);
      }
      const retryAfter = Number(res.headers?.get("retry-after"));
      const delay = retryAfter > 0 ? retryAfter * 1000 : retryBaseDelayMs * 2 ** attempt;
      console.warn(`  Avalanche ${res.status} on ${url} — retrying in ${delay}ms`);
      await sleep(delay);
    } catch (err) {
      if (attempt >= retryMaxAttempts || (err as Error).message?.startsWith("Avalanche API error")) {
        throw err;
      }
      const delay = retryBaseDelayMs * 2 ** attempt;
      console.warn(`  Avalanche request failed (${(err as Error).message}) — retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
}

// --- Normalized shapes ------------------------------------------------------

// Danger ratings for one validity day, split into the three elevation bands.
// Each value is 0 (no rating) or 1–5 on the North American Avalanche Danger Scale.
export interface DangerByElevation {
  day: string; // "current" | "tomorrow"
  upper: number;
  middle: number;
  lower: number;
}

// One avalanche problem (e.g. Wind Slab). `location` holds aspect+elevation
// tokens like "north upper" used to shade the aspect/elevation rose.
export interface AvalancheProblem {
  rank: number | null;
  name: string;
  likelihood: string | null; // e.g. "likely", "possible"
  sizeMin: string | null;
  sizeMax: string | null;
  location: string[]; // e.g. ["north upper", "northeast upper"]
  description: string | null; // HTML
}

// Flat snapshot of a zone's forecast, ready to persist + render.
export interface AvalancheForecast {
  centerId: string;
  zoneId: number;
  zoneName: string;
  productType: string; // "forecast" | "summary"
  offSeason: boolean;
  dangerLevel: number; // overall (max band of "current" day), -1 if none
  publishedTime: string | null;
  expiresTime: string | null;
  author: string | null;
  bottomLine: string | null; // HTML
  hazardDiscussion: string | null; // HTML
  weatherDiscussion: string | null; // HTML
  danger: DangerByElevation[];
  problems: AvalancheProblem[];
  link: string | null;
}

// Lightweight per-zone status pulled from the map-layer endpoint (used as a
// fallback for off-season/empty products and for the overview card).
export interface ZoneStatus {
  dangerLevel: number;
  offSeason: boolean;
  link: string | null;
  startDate: string | null;
  endDate: string | null;
}

// --- Normalization ----------------------------------------------------------

function toBand(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDanger(raw: any[]): DangerByElevation[] {
  return (raw ?? []).map((d) => ({
    day: String(d?.valid_day ?? "current"),
    upper: toBand(d?.upper),
    middle: toBand(d?.middle),
    lower: toBand(d?.lower),
  }));
}

function normalizeProblems(raw: any[]): AvalancheProblem[] {
  return (raw ?? []).map((p) => {
    const size = Array.isArray(p?.size) ? p.size : [];
    return {
      rank: p?.rank != null ? Number(p.rank) : null,
      name: String(p?.name ?? "Avalanche Problem"),
      likelihood: p?.likelihood ?? null,
      sizeMin: size[0] != null ? String(size[0]) : null,
      sizeMax: size[1] != null ? String(size[1]) : null,
      location: Array.isArray(p?.location) ? p.location.map((l: unknown) => String(l)) : [],
      description: p?.problem_description ?? null,
    };
  });
}

// Overall danger = the highest band of the "current" day (centers headline the
// worst elevation). Falls back to -1 when there are no ratings.
function overallDanger(danger: DangerByElevation[]): number {
  const current = danger.find((d) => d.day === "current") ?? danger[0];
  if (!current) return -1;
  const max = Math.max(current.upper, current.middle, current.lower);
  return max > 0 ? max : -1;
}

// --- Public API -------------------------------------------------------------

// Pure normalizer: turn a raw NAC product into our flat shape. Exported so it
// can be unit-tested against fixtures without hitting the network.
export function normalizeProduct(
  product: any,
  centerId: string,
  zoneId: number,
  zoneName: string
): AvalancheForecast {
  const danger = normalizeDanger(product?.danger ?? []);
  const problems = normalizeProblems(product?.forecast_avalanche_problems ?? []);
  const productType = String(product?.product_type ?? "summary");
  // A "summary"-type product (or empty danger) means no active daily forecast.
  const offSeason = productType !== "forecast" || danger.length === 0;
  const zone = Array.isArray(product?.forecast_zone) ? product.forecast_zone[0] : null;

  return {
    centerId,
    zoneId,
    zoneName,
    productType,
    offSeason,
    dangerLevel: overallDanger(danger),
    publishedTime: product?.published_time ?? null,
    expiresTime: product?.expires_time ?? null,
    author: product?.author ?? null,
    bottomLine: product?.bottom_line ?? null,
    hazardDiscussion: product?.hazard_discussion ?? null,
    weatherDiscussion: product?.weather_discussion ?? null,
    danger,
    problems,
    link: zone?.url ?? null,
  };
}

// Fetch + normalize the current forecast product for one zone.
export async function fetchForecast(
  centerId: string,
  zoneId: number,
  zoneName: string
): Promise<AvalancheForecast> {
  const product = await avyFetch(
    `${config.avalancheBaseUrl}/product?type=forecast&center_id=${centerId}&zone_id=${zoneId}`
  );
  return normalizeProduct(product, centerId, zoneId, zoneName);
}

// Lightweight status from the per-center map layer. Useful when the product is
// off-season (no danger array) but we still want the link and season window.
export async function fetchZoneStatus(centerId: string, zoneId: number): Promise<ZoneStatus | null> {
  const geo = await avyFetch(`${config.avalancheBaseUrl}/products/map-layer/${centerId}`);
  const feature = (geo?.features ?? []).find(
    (f: any) => Number(f?.properties?.id) === zoneId || f?.properties?.center_id === centerId
  );
  const p = feature?.properties;
  if (!p) return null;
  return {
    dangerLevel: p.danger_level ?? -1,
    offSeason: Boolean(p.off_season),
    link: p.link ?? null,
    startDate: p.start_date ?? null,
    endDate: p.end_date ?? null,
  };
}
