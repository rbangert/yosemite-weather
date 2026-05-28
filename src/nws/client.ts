import { config } from "../config";

// --- HTTP -------------------------------------------------------------------

async function nwsFetch(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": config.nwsUserAgent,
      Accept: "application/geo+json",
    },
  });
  if (!res.ok) {
    throw new Error(`NWS API error ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
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
  windSpeed: number | null;
  windGust: number | null;
  windDirection: number | null;
  precipProb: number | null;
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
function durationHours(iso: string): number {
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
function expandLayer(
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
  const windSpeed = expandLayer(p.windSpeed, { convert: kmhToMph });
  const windGust = expandLayer(p.windGust, { convert: kmhToMph });
  const windDir = expandLayer(p.windDirection);
  const pop = expandLayer(p.probabilityOfPrecipitation);
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
    windSpeed: windSpeed.get(k) ?? null,
    windGust: windGust.get(k) ?? null,
    windDirection: windDir.get(k) ?? null,
    precipProb: pop.get(k) ?? null,
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
}

const val = (m: any): number | null =>
  m && typeof m.value === "number" ? m.value : null;
const conv = (m: any, f: (v: number) => number): number | null => {
  const v = val(m);
  return v == null ? null : f(v);
};

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
  };
}
