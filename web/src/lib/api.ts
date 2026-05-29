const API_BASE = import.meta.env.API_BASE ?? "http://localhost:3000";

export interface ForecastRow {
  valid_time: string;
  air_temp: number | null;
  wind_speed: number | null;
  wind_gust: number | null;
  wind_direction: number | null;
  precip_prob: number | null;
  relative_humidity: number | null;
  snowfall_amount: number | null;
  snow_level: number | null;
  sky_cover: number | null;
}

export interface ObservationRow {
  id: number;
  point_slug: string;
  station_id: string;
  observed_at: string;
  polled_at: string;
  air_temp: number | null;
  wind_speed: number | null;
  wind_gust: number | null;
  wind_direction: number | null;
  relative_humidity: number | null;
  precip_last_hour: number | null;
  snow_depth: number | null;
}

export interface PointOverview {
  slug: string;
  name: string;
  forecast: ForecastRow | null;
  observation: ObservationRow | null;
}

export interface AreaOverview {
  slug: string;
  name: string;
  points: PointOverview[];
}

export interface AreaConfig {
  slug: string;
  name: string;
  points: Array<{ slug: string; name: string; latitude: number; longitude: number }>;
}

export async function fetchOverview(): Promise<AreaOverview[]> {
  const res = await fetch(`${API_BASE}/api/overview`);
  if (!res.ok) throw new Error(`Overview fetch failed: ${res.status}`);
  return res.json() as Promise<AreaOverview[]>;
}

export async function fetchAreas(): Promise<AreaConfig[]> {
  const res = await fetch(`${API_BASE}/api/areas`);
  if (!res.ok) throw new Error(`Areas fetch failed: ${res.status}`);
  return res.json() as Promise<AreaConfig[]>;
}

export async function fetchForecast(slug: string, hours = 72): Promise<ForecastRow[]> {
  const res = await fetch(`${API_BASE}/api/points/${encodeURIComponent(slug)}/forecast?hours=${hours}`);
  if (!res.ok) throw new Error(`Forecast fetch failed: ${res.status}`);
  return res.json() as Promise<ForecastRow[]>;
}

export async function fetchLatestObservation(slug: string): Promise<ObservationRow | null> {
  const res = await fetch(`${API_BASE}/api/points/${encodeURIComponent(slug)}/observations/latest`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Observation fetch failed: ${res.status}`);
  return res.json() as Promise<ObservationRow>;
}

// --- Alerts -----------------------------------------------------------------

export interface AlertRow {
  id: string;
  event: string;
  severity: string;
  urgency: string;
  certainty: string;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  area_desc: string | null;
  effective: string | null;
  onset: string | null;
  expires: string;
  ends: string | null;
  fetched_at: string;
}

export async function fetchAlerts(): Promise<AlertRow[]> {
  try {
    const res = await fetch(`${API_BASE}/api/alerts`);
    if (!res.ok) return [];
    return res.json() as Promise<AlertRow[]>;
  } catch {
    return [];
  }
}

// --- Data Explorer ----------------------------------------------------------

export interface ObsHistoryRow {
  station_id: string;
  observed_at: string;
  air_temp: number | null;
  wind_speed: number | null;
  wind_gust: number | null;
  wind_direction: number | null;
  relative_humidity: number | null;
  precip_last_hour: number | null;
  snow_depth: number | null;
  source: string;
}

export interface CoverageRow {
  slug: string;
  name: string;
  area_slug: string;
  area_name: string;
  has_forecast: 0 | 1;
  latest_obs_at: string | null;
  obs_source: string | null;
  station_id: string | null;
}

export interface DataExplorerPayload {
  summary: {
    totalPoints: number;
    pointsWithForecasts: number;
    pointsWithObservations: number;
    activeForecastRows: number;
    totalObservationRows: number;
    nwsObsRows: number;
    synopticObsRows: number;
    lastFetchedAt: string | null;
  };
  samplePoint: {
    slug: string;
    name: string;
    forecast: ForecastRow[];
    obsHistory: ObsHistoryRow[];
  } | null;
  coverage: CoverageRow[];
}

export async function fetchDataExplorer(): Promise<DataExplorerPayload> {
  const res = await fetch(`${API_BASE}/api/data-explorer`);
  if (!res.ok) throw new Error(`Data explorer fetch failed: ${res.status}`);
  return res.json() as Promise<DataExplorerPayload>;
}
