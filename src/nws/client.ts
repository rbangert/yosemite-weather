import { config } from "../config";

// --- HTTP -------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Transient statuses worth retrying. Other 4xx (e.g. 404) are permanent.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// Fetch with exponential backoff. Retries network errors and transient 5xx/429
// responses (honoring Retry-After when present), but throws immediately on
// permanent failures like 404.
async function nwsFetch(url: string): Promise<any> {
  const { retryMaxAttempts, retryBaseDelayMs } = config;

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": config.nwsUserAgent,
          Accept: "application/geo+json",
        },
      });

      if (res.ok) return res.json();

      if (!RETRYABLE_STATUS.has(res.status) || attempt >= retryMaxAttempts) {
        throw new Error(`NWS API error ${res.status} ${res.statusText} for ${url}`);
      }

      const retryAfter = Number(res.headers?.get("retry-after"));
      const delay = retryAfter > 0 ? retryAfter * 1000 : retryBaseDelayMs * 2 ** attempt;
      console.warn(`  NWS ${res.status} on ${url} — retrying in ${delay}ms`);
      await sleep(delay);
    } catch (err) {
      // A thrown Error here is either our non-retryable status above or a
      // network failure. Re-throw once retries are exhausted.
      if (attempt >= retryMaxAttempts || (err as Error).message?.startsWith("NWS API error")) {
        throw err;
      }
      const delay = retryBaseDelayMs * 2 ** attempt;
      console.warn(`  NWS request failed (${(err as Error).message}) — retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
}

// --- Unit conversions -------------------------------------------------------

const cToF = (c: number) => (c * 9) / 5 + 32;
const kmhToMph = (k: number) => k * 0.621371;
const mmToIn = (m: number) => m / 25.4;
const mToFt = (m: number) => m * 3.28084;

// --- Point resolution -------------------------------------------------------

export interface ResolvedPoint {
  gridId: string;
  gridX: number;
  gridY: number;
  stationId: string | null;
}

export async function resolvePoint(lat: number, lon: number): Promise<ResolvedPoint> {
  // NWS requires coordinates rounded to <=4 decimals (otherwise it redirects).
  const point = await nwsFetch(
    `${config.nwsBaseUrl}/points/${lat.toFixed(4)},${lon.toFixed(4)}`
  );
  const props = point.properties;

  let stationId: string | null = null;
  try {
    const stations = await nwsFetch(props.observationStations);
    stationId = stations.features?.[0]?.properties?.stationIdentifier ?? null;
  } catch {
    // A point may have no nearby station; forecasts still work.
    stationId = null;
  }

  return {
    gridId: props.gridId,
    gridX: props.gridX,
    gridY: props.gridY,
    stationId,
  };
}

// --- Forecast ---------------------------------------------------------------

export interface ForecastHour {
  validTime: string; // ISO hour (UTC)
  airTemp: number | null;
  apparentTemp: number | null;
  dewpoint: number | null;
  windSpeed: number | null;
  windGust: number | null;
  windDirection: number | null;
  precipProb: number | null;
  thunderProb: number | null;
  relativeHumidity: number | null;
  snowfallAmount: number | null;
  snowLevel: number | null;
  skyCover: number | null;
}

interface GridLayer {
  uom?: string;
  values?: { validTime: string; value: number | null }[];
}

// ISO 8601 duration -> hours (covers the W/D/H/M parts NWS emits, e.g. PT6H, P1DT1H).
export function durationHours(iso: string): number {
  const m = iso.match(/P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);
  if (!m) return 1;
  const [, w, d, h, min] = m.map((x) => (x ? Number(x) : 0));
  return w * 168 + d * 24 + h + min / 60;
}

function hourKey(date: Date): string {
  return date.toISOString().slice(0, 13) + ":00:00Z";
}

// Expand a gridpoint layer's interval values into a per-hour map.
// Accumulation layers (e.g. snowfall) are divided evenly across the interval;
// instantaneous layers carry their value across each hour they cover.
export function expandLayer(
  layer: GridLayer | undefined,
  opts: { accumulation?: boolean; convert?: (v: number) => number } = {}
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  if (!layer?.values) return out;

  for (const { validTime, value } of layer.values) {
    const [start, dur] = validTime.split("/");
    const hours = Math.max(1, Math.round(durationHours(dur)));
    let v = value;
    if (v != null) {
      if (opts.accumulation) v = v / hours;
      if (opts.convert) v = opts.convert(v);
    }
    const startMs = new Date(start).getTime();
    for (let h = 0; h < hours; h++) {
      out.set(hourKey(new Date(startMs + h * 3_600_000)), v);
    }
  }
  return out;
}

export async function fetchGridpointForecast(
  gridId: string,
  gridX: number,
  gridY: number,
  horizonHours: number
): Promise<ForecastHour[]> {
  const data = await nwsFetch(`${config.nwsBaseUrl}/gridpoints/${gridId}/${gridX},${gridY}`);
  const p = data.properties;

  const temp = expandLayer(p.temperature, { convert: cToF });
  const apparentTemp = expandLayer(p.apparentTemperature, { convert: cToF });
  const dewpoint = expandLayer(p.dewpoint, { convert: cToF });
  const windSpeed = expandLayer(p.windSpeed, { convert: kmhToMph });
  const windGust = expandLayer(p.windGust, { convert: kmhToMph });
  const windDir = expandLayer(p.windDirection);
  const pop = expandLayer(p.probabilityOfPrecipitation);
  const thunder = expandLayer(p.probabilityOfThunder);
  const rh = expandLayer(p.relativeHumidity);
  const snowfall = expandLayer(p.snowfallAmount, { accumulation: true, convert: mmToIn });
  const snowLevel = expandLayer(p.snowLevel, { convert: mToFt });
  const sky = expandLayer(p.skyCover);

  // Temperature is the densest hourly layer; use it as the time spine.
  const cutoff = Date.now() + horizonHours * 3_600_000;
  const hours = [...temp.keys()]
    .filter((k) => new Date(k).getTime() <= cutoff)
    .sort();

  return hours.map((k) => ({
    validTime: k,
    airTemp: temp.get(k) ?? null,
    apparentTemp: apparentTemp.get(k) ?? null,
    dewpoint: dewpoint.get(k) ?? null,
    windSpeed: windSpeed.get(k) ?? null,
    windGust: windGust.get(k) ?? null,
    windDirection: windDir.get(k) ?? null,
    precipProb: pop.get(k) ?? null,
    thunderProb: thunder.get(k) ?? null,
    relativeHumidity: rh.get(k) ?? null,
    snowfallAmount: snowfall.get(k) ?? null,
    snowLevel: snowLevel.get(k) ?? null,
    skyCover: sky.get(k) ?? null,
  }));
}

// --- Observations -----------------------------------------------------------

export interface LatestObservation {
  observedAt: string;
  airTemp: number | null;
  windSpeed: number | null;
  windGust: number | null;
  windDirection: number | null;
  relativeHumidity: number | null;
  precipLastHour: number | null;
  snowDepth: number | null;
}

const val = (m: any): number | null =>
  m && typeof m.value === "number" ? m.value : null;
const conv = (m: any, f: (v: number) => number): number | null => {
  const v = val(m);
  return v == null ? null : f(v);
};

// --- Alerts -----------------------------------------------------------------

export interface NwsAlert {
  id: string;
  event: string;
  severity: string;
  urgency: string;
  certainty: string;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  areaDesc: string | null;
  effective: string | null;
  onset: string | null;
  expires: string;
  ends: string | null;
}

// Fetch all currently active alerts for the given NWS zone IDs. Deduplicates
// alerts that appear in multiple zones (same NWS alert ID).
export async function fetchActiveAlerts(zones: string[]): Promise<NwsAlert[]> {
  const seen = new Set<string>();
  const alerts: NwsAlert[] = [];

  for (const zone of zones) {
    const data = await nwsFetch(`${config.nwsBaseUrl}/alerts/active/zone/${zone}`);
    for (const feature of data.features ?? []) {
      const p = feature.properties;
      if (!p?.id || seen.has(p.id)) continue;
      seen.add(p.id);
      alerts.push({
        id: p.id,
        event: p.event ?? "Unknown",
        severity: p.severity ?? "Unknown",
        urgency: p.urgency ?? "Unknown",
        certainty: p.certainty ?? "Unknown",
        headline: p.headline ?? null,
        description: p.description ?? null,
        instruction: p.instruction ?? null,
        areaDesc: p.areaDesc ?? null,
        effective: p.effective ?? null,
        onset: p.onset ?? null,
        expires: p.expires,
        ends: p.ends ?? null,
      });
    }
  }

  return alerts;
}

// --- Period forecast (7-day, 12-hour periods) --------------------------------

export interface ForecastPeriod {
  number: number;
  name: string;
  startTime: string;
  endTime: string;
  isDaytime: boolean;
  temperature: number;      // °F
  windSpeed: string;        // NWS text, e.g. "10 to 15 mph"
  windDirection: string;    // "W", "NW", etc.
  precipProb: number | null;
  shortForecast: string;
  detailedForecast: string;
  iconUrl: string;
}

export async function fetchPeriodForecast(
  gridId: string,
  gridX: number,
  gridY: number
): Promise<ForecastPeriod[]> {
  const data = await nwsFetch(
    `${config.nwsBaseUrl}/gridpoints/${gridId}/${gridX},${gridY}/forecast`
  );
  return (data.properties?.periods ?? []).map((p: any): ForecastPeriod => ({
    number: p.number,
    name: p.name,
    startTime: p.startTime,
    endTime: p.endTime,
    isDaytime: p.isDaytime,
    temperature: p.temperature,
    windSpeed: p.windSpeed ?? "",
    windDirection: p.windDirection ?? "",
    precipProb: p.probabilityOfPrecipitation?.value ?? null,
    shortForecast: p.shortForecast ?? "",
    detailedForecast: p.detailedForecast ?? "",
    iconUrl: p.icon ?? "",
  }));
}

export async function fetchLatestObservation(
  stationId: string
): Promise<LatestObservation | null> {
  const data = await nwsFetch(
    `${config.nwsBaseUrl}/stations/${stationId}/observations/latest`
  );
  const p = data.properties;
  if (!p?.timestamp) return null;

  return {
    observedAt: p.timestamp,
    airTemp: conv(p.temperature, cToF),
    windSpeed: conv(p.windSpeed, kmhToMph),
    windGust: conv(p.windGust, kmhToMph),
    windDirection: val(p.windDirection),
    relativeHumidity: val(p.relativeHumidity),
    precipLastHour: conv(p.precipitationLastHour, mmToIn),
    snowDepth: conv(p.snowDepth, mmToIn),
  };
}
