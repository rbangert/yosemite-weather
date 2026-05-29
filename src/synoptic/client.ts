import { config } from "../config";

// --- HTTP -------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

async function synopticFetch(endpoint: string, params: Record<string, string>): Promise<any> {
  const { retryMaxAttempts, retryBaseDelayMs, synopticBaseUrl, synopticApiToken } = config;

  // Token appended last so it doesn't show up in error messages built from url
  const qs = new URLSearchParams({ ...params, token: synopticApiToken }).toString();
  const url = `${synopticBaseUrl}${endpoint}?${qs}`;

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": config.nwsUserAgent },
      });

      if (res.ok) {
        const data = await res.json();
        // Synoptic returns 200 with RESPONSE_CODE 2 for "no data found"
        if (data?.SUMMARY?.RESPONSE_CODE === 2) return null;
        if (data?.SUMMARY?.RESPONSE_CODE === 5) {
          throw new Error(`Synoptic auth error — check SYNOPTIC_API_TOKEN`);
        }
        return data;
      }

      if (!RETRYABLE_STATUS.has(res.status) || attempt >= retryMaxAttempts) {
        // Read body as text first so we can log it and parse it without
        // consuming the stream twice.
        let bodyText = "";
        try { bodyText = await res.text(); } catch {}
        console.warn(`  Synoptic ${res.status} raw body: ${bodyText.slice(0, 400) || "(empty)"}`);

        let detail = bodyText.slice(0, 200);
        try {
          const body = JSON.parse(bodyText);
          detail =
            body?.SUMMARY?.RESPONSE_MESSAGE ??
            body?.message ??
            body?.error ??
            JSON.stringify(body).slice(0, 200);
        } catch {}
        throw new Error(`Synoptic API ${res.status} for ${endpoint}${detail ? ` — ${detail}` : ""}`);
      }

      const retryAfter = Number(res.headers?.get("retry-after"));
      const delay = retryAfter > 0 ? retryAfter * 1000 : retryBaseDelayMs * 2 ** attempt;
      console.warn(`  Synoptic ${res.status} — retrying in ${delay}ms`);
      await sleep(delay);
    } catch (err) {
      if (attempt >= retryMaxAttempts || (err as Error).message?.startsWith("Synoptic")) {
        throw err;
      }
      const delay = retryBaseDelayMs * 2 ** attempt;
      console.warn(`  Synoptic request failed (${(err as Error).message}) — retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
}

// --- Types ------------------------------------------------------------------

export interface SynopticStation {
  stid: string;
  name: string;
  latitude: number;
  longitude: number;
  elevation: number; // feet
}

export interface SynopticObservation {
  stid: string;
  observedAt: string;            // ISO 8601
  airTemp: number | null;        // °F
  windSpeed: number | null;      // mph
  windGust: number | null;       // mph
  windDirection: number | null;  // degrees
  relativeHumidity: number | null; // %
  precipLastHour: number | null; // inches
  snowDepth: number | null;      // inches
}

// --- Station discovery ------------------------------------------------------

// Find the nearest active station within radiusMiles of the given coordinate
// using the /stations/latest endpoint (available on the free tier).
//
// Returns null when the API responds successfully but no station is within
// range — this is a legitimate "no coverage" result, not an error.
// Throws on API/network failures so callers can distinguish the two cases
// and avoid caching a failed lookup as "no coverage".
export async function findNearestStation(
  lat: number,
  lon: number,
  radiusMiles: number
): Promise<SynopticStation | null> {
  // Use within=1440 (24 h) for discovery: we want the nearest station that
  // has reported recently, even if it hasn't updated in the last few hours.
  const data = await synopticFetch("/stations/latest", {
    radius: `${lat},${lon},${radiusMiles}`,
    limit: "1",
    vars: "air_temp",
    within: "1440",
    units: "english",
  });

  const s = data?.STATION?.[0];
  if (!s) return null;

  return {
    stid: s.STID as string,
    name: s.NAME as string,
    latitude: Number(s.LATITUDE),
    longitude: Number(s.LONGITUDE),
    elevation: Number(s.ELEVATION),
  };
}

// --- Observations -----------------------------------------------------------

// Extract a sensor reading from a Synoptic OBSERVATIONS object.
// Synoptic suffixes sensor values with _value_1 (primary sensor), _value_2, …
function obsVal(obs: Record<string, any>, key: string): number | null {
  const sensor = obs[`${key}_value_1`];
  if (!sensor || typeof sensor.value !== "number") return null;
  return sensor.value;
}

// Pick the most recent date_time string across a set of sensor keys.
function latestDate(obs: Record<string, any>, keys: string[]): string {
  const dates = keys
    .map((k) => obs[`${k}_value_1`]?.date_time)
    .filter((d): d is string => typeof d === "string");
  return dates.sort().at(-1) ?? new Date().toISOString();
}

// Batch-fetch latest observations for a list of station IDs (up to ~100 at
// once). Each call costs 1 service unit per station returned (free tier:
// ~500 SU/day). Observations within the last 2 hours are considered current.
//
// Uses units=english so all values arrive in °F / mph / inches without
// requiring local conversion.
export async function fetchLatestObservations(stids: string[]): Promise<SynopticObservation[]> {
  if (stids.length === 0) return [];

  const data = await synopticFetch("/stations/latest", {
    stid: stids.join(","),
    vars: [
      "air_temp",
      "wind_speed",
      "wind_gust",
      "wind_direction",
      "relative_humidity",
      "precip_accum_one_hour",
      "snow_depth",
    ].join(","),
    units: "english",
    within: "120",
  });

  const stations: any[] = data?.STATION ?? [];

  return stations.map((s) => {
    const obs: Record<string, any> = s.OBSERVATIONS ?? {};
    return {
      stid: s.STID as string,
      observedAt: latestDate(obs, ["air_temp", "wind_speed", "relative_humidity"]),
      airTemp: obsVal(obs, "air_temp"),
      windSpeed: obsVal(obs, "wind_speed"),
      windGust: obsVal(obs, "wind_gust"),
      windDirection: obsVal(obs, "wind_direction"),
      relativeHumidity: obsVal(obs, "relative_humidity"),
      precipLastHour: obsVal(obs, "precip_accum_one_hour"),
      snowDepth: obsVal(obs, "snow_depth"),
    };
  });
}
