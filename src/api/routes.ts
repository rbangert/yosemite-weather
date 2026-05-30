import { getDb } from "../db";
import { areas, config } from "../config";

export function handleRequest(req: Request): Response {
  const url = new URL(req.url);
  const { pathname } = url;

  if (pathname === "/health") return handleHealth();
  if (pathname === "/api/areas") return json(areas);
  if (pathname === "/api/overview") return handleOverview();

  const forecast = pathname.match(/^\/api\/points\/([^/]+)\/forecast$/);
  if (forecast) {
    const hours = Number(url.searchParams.get("hours") ?? "24");
    return handleForecast(forecast[1], hours);
  }

  const latest = pathname.match(/^\/api\/points\/([^/]+)\/observations\/latest$/);
  if (latest) return handleLatestObservation(latest[1]);

  const periods = pathname.match(/^\/api\/points\/([^/]+)\/forecast\/periods$/);
  if (periods) return handlePeriodForecast(periods[1]);

  if (pathname === "/api/alerts") return handleAlerts();
  if (pathname === "/api/data-explorer") return handleDataExplorer();
  if (pathname === "/api/swe") return handleSweStations();

  const sweStation = pathname.match(/^\/api\/swe\/([^/]+)$/);
  if (sweStation) return handleSwe(sweStation[1]);

  return json({ error: "Not found" }, 404);
}

// Health check with last-poll staleness. Returns 503 when data is stale or
// missing so it can back a real uptime probe. "Stale" means the most recent
// forecast write is older than twice the poll interval.
function handleHealth(): Response {
  const db = getDb();
  const lastPoll = (db.prepare(`SELECT MAX(fetched_at) m FROM forecasts`).get() as any).m as
    | string
    | null;
  const points = db
    .prepare(`SELECT COUNT(*) total, COUNT(grid_id) resolved FROM points`)
    .get() as { total: number; resolved: number };
  const withObservations = (
    db.prepare(`SELECT COUNT(DISTINCT point_slug) c FROM observations`).get() as { c: number }
  ).c;

  const staleThresholdMs = config.pollIntervalMs * 2;
  const ageMs = lastPoll ? Date.now() - new Date(lastPoll).getTime() : null;

  const status =
    lastPoll == null ? "no_data" : ageMs! > staleThresholdMs ? "stale" : "ok";

  return json(
    {
      status,
      lastPollAt: lastPoll,
      ageSeconds: ageMs == null ? null : Math.round(ageMs / 1000),
      staleThresholdSeconds: Math.round(staleThresholdMs / 1000),
      points: { total: points.total, resolved: points.resolved, withObservations },
      forecastRows: (db.prepare(`SELECT COUNT(*) c FROM forecasts`).get() as { c: number }).c,
      observationRows: (db.prepare(`SELECT COUNT(*) c FROM observations`).get() as { c: number })
        .c,
    },
    status === "ok" ? 200 : 503
  );
}

// Latest forecast hour (closest to now) + latest observation per point, grouped by area.
function handleOverview(): Response {
  const db = getDb();
  const now = new Date().toISOString().slice(0, 13) + ":00:00Z";

  const rows = db
    .prepare(
      `SELECT
         p.slug, p.name, p.area_slug, p.area_name,
         f.valid_time, f.air_temp, f.wind_speed, f.wind_gust, f.wind_direction,
         f.precip_prob, f.relative_humidity, f.snowfall_amount, f.snow_level, f.sky_cover
       FROM points p
       LEFT JOIN forecasts f ON f.id = (
         SELECT id FROM forecasts
         WHERE point_slug = p.slug AND valid_time >= ?
         ORDER BY valid_time ASC LIMIT 1
       )
       ORDER BY p.area_slug, p.name`
    )
    .all(now) as any[];

  const latestObs = db.prepare(
    `SELECT * FROM observations WHERE point_slug = ? ORDER BY observed_at DESC LIMIT 1`
  );

  const grouped: Record<string, any> = {};
  for (const r of rows) {
    if (!grouped[r.area_slug]) {
      grouped[r.area_slug] = { slug: r.area_slug, name: r.area_name, points: [] };
    }
    const { area_slug, area_name, slug, name, ...forecast } = r;
    grouped[r.area_slug].points.push({
      slug,
      name,
      forecast: forecast.valid_time ? forecast : null,
      observation: latestObs.get(slug) ?? null,
    });
  }

  return json(Object.values(grouped));
}

function handleForecast(slug: string, hours: number): Response {
  const db = getDb();
  if (!pointExists(slug)) return json({ error: "Unknown point" }, 404);

  const now = new Date().toISOString().slice(0, 13) + ":00:00Z";
  const until = new Date(Date.now() + hours * 3_600_000).toISOString();

  const rows = db
    .prepare(
      `SELECT valid_time, air_temp, wind_speed, wind_gust, wind_direction,
              precip_prob, relative_humidity, snowfall_amount, snow_level, sky_cover
       FROM forecasts
       WHERE point_slug = ? AND valid_time >= ? AND valid_time <= ?
       ORDER BY valid_time ASC`
    )
    .all(slug, now, until);

  return json(rows);
}

function handleLatestObservation(slug: string): Response {
  const db = getDb();
  if (!pointExists(slug)) return json({ error: "Unknown point" }, 404);

  const row = db
    .prepare(`SELECT * FROM observations WHERE point_slug = ? ORDER BY observed_at DESC LIMIT 1`)
    .get(slug);

  if (!row) return json({ error: "No observations available for this point" }, 404);
  return json(row);
}

// NWS 7-day period forecast (12-hour day/night periods) for a point.
// Returns only future periods, ordered by start_time.
function handlePeriodForecast(slug: string): Response {
  const db = getDb();
  if (!pointExists(slug)) return json({ error: "Unknown point" }, 404);

  const rows = db
    .prepare(
      `SELECT period_number, name, start_time, end_time, is_daytime,
              temperature, wind_speed, wind_direction, precip_prob,
              short_forecast, detailed_forecast, icon_url
       FROM period_forecasts
       WHERE point_slug = ? AND datetime(end_time) >= datetime('now')
       ORDER BY start_time ASC`
    )
    .all(slug);

  return json(rows);
}

// Active NWS alerts (not yet expired). Ordered most-severe first.
function handleAlerts(): Response {
  const db = getDb();
  const now = new Date().toISOString();
  const severityOrder = `CASE severity
    WHEN 'Extreme'  THEN 0
    WHEN 'Severe'   THEN 1
    WHEN 'Moderate' THEN 2
    WHEN 'Minor'    THEN 3
    ELSE 4 END`;
  const rows = db
    .prepare(
      `SELECT id, event, severity, urgency, certainty, headline, description,
              instruction, area_desc, effective, onset, expires, ends, fetched_at
       FROM alerts
       WHERE COALESCE(ends, expires) > ?
       ORDER BY ${severityOrder}, onset ASC`
    )
    .all(now);
  return json(rows);
}

// Aggregated payload for the data-explorer visualisation page.
function handleDataExplorer(): Response {
  const db = getDb();
  const now = new Date().toISOString().slice(0, 13) + ":00:00Z";

  const summary = {
    totalPoints:            (db.prepare(`SELECT COUNT(*) c FROM points`).get() as any).c,
    pointsWithForecasts:    (db.prepare(`SELECT COUNT(DISTINCT point_slug) c FROM forecasts WHERE valid_time >= ?`).get(now) as any).c,
    pointsWithObservations: (db.prepare(`SELECT COUNT(DISTINCT point_slug) c FROM observations`).get() as any).c,
    activeForecastRows:     (db.prepare(`SELECT COUNT(*) c FROM forecasts WHERE valid_time >= ?`).get(now) as any).c,
    totalObservationRows:   (db.prepare(`SELECT COUNT(*) c FROM observations`).get() as any).c,
    nwsObsRows:             (db.prepare(`SELECT COUNT(*) c FROM observations WHERE COALESCE(source,'nws') != 'synoptic'`).get() as any).c,
    synopticObsRows:        (db.prepare(`SELECT COUNT(*) c FROM observations WHERE source = 'synoptic'`).get() as any).c,
    lastFetchedAt:          (db.prepare(`SELECT MAX(fetched_at) m FROM forecasts`).get() as any).m as string | null,
  };

  // Sample point: pick whichever has the most active forecast rows (best coverage).
  const sampleMeta = db.prepare(`
    SELECT p.slug, p.name
    FROM points p
    JOIN forecasts f ON f.point_slug = p.slug AND f.valid_time >= ?
    GROUP BY p.slug ORDER BY COUNT(*) DESC LIMIT 1
  `).get(now) as { slug: string; name: string } | undefined;

  let samplePoint: any = null;
  if (sampleMeta) {
    const forecast = db.prepare(`
      SELECT valid_time, air_temp, wind_speed, wind_gust, wind_direction,
             precip_prob, relative_humidity, snowfall_amount, snow_level, sky_cover
      FROM forecasts WHERE point_slug = ? AND valid_time >= ?
      ORDER BY valid_time ASC LIMIT 72
    `).all(sampleMeta.slug, now);

    const obsHistory = db.prepare(`
      SELECT station_id, observed_at, air_temp, wind_speed, wind_gust,
             wind_direction, relative_humidity, precip_last_hour, snow_depth,
             COALESCE(source, 'nws') AS source
      FROM observations WHERE point_slug = ?
      ORDER BY observed_at DESC LIMIT 48
    `).all(sampleMeta.slug);

    samplePoint = { slug: sampleMeta.slug, name: sampleMeta.name, forecast, obsHistory };
  }

  // Per-point coverage for the grid.
  const coverage = db.prepare(`
    SELECT
      p.slug, p.name, p.area_slug, p.area_name,
      CASE WHEN (SELECT COUNT(*) FROM forecasts f WHERE f.point_slug = p.slug AND f.valid_time >= ?) > 0
           THEN 1 ELSE 0 END AS has_forecast,
      (SELECT MAX(observed_at) FROM observations WHERE point_slug = p.slug) AS latest_obs_at,
      (SELECT COALESCE(source,'nws') FROM observations WHERE point_slug = p.slug ORDER BY observed_at DESC LIMIT 1) AS obs_source,
      (SELECT station_id FROM observations WHERE point_slug = p.slug ORDER BY observed_at DESC LIMIT 1) AS station_id
    FROM points p
    ORDER BY p.area_slug, p.name
  `).all(now);

  return json({ summary, samplePoint, coverage });
}

// SWE: list all SNOTEL stations we have data for.
function handleSweStations(): Response {
  const db = getDb();
  const stations = db.prepare(`SELECT station_id, name, elevation_ft, latitude, longitude FROM snotel_stations ORDER BY elevation_ft DESC`).all();
  return json({ stations });
}

// SWE: return all cached readings for one station, grouped by water year.
// Each water-year entry is an array of { day, date, value } sorted by day.
function handleSwe(stationId: string): Response {
  const db = getDb();

  const station = db.prepare(`SELECT station_id, name, elevation_ft, latitude, longitude FROM snotel_stations WHERE station_id = ?`).get(stationId.toUpperCase());
  if (!station) return json({ error: "Unknown SNOTEL station" }, 404);

  const rows = db.prepare(`SELECT date, value_in FROM swe_readings WHERE station_id = ? ORDER BY date ASC`).all(stationId.toUpperCase()) as { date: string; value_in: number | null }[];

  // Group into water years, computing day-of-water-year for the x-axis.
  const waterYears: Record<string, { day: number; date: string; value: number | null }[]> = {};

  for (const row of rows) {
    const wy = toWaterYear(row.date);
    const day = toWaterYearDay(row.date);
    if (!waterYears[wy]) waterYears[wy] = [];
    waterYears[wy].push({ day, date: row.date, value: row.value_in });
  }

  return json({ station, waterYears });
}

function toWaterYear(dateStr: string): string {
  const [year, month] = dateStr.split("-").map(Number);
  return String(month >= 10 ? year + 1 : year);
}

function toWaterYearDay(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  const wy = month >= 10 ? year + 1 : year;
  const wyStartMs = Date.UTC(wy - 1, 9, 1); // Oct 1 = month index 9
  const dateMs = Date.UTC(year, month - 1, day);
  return Math.round((dateMs - wyStartMs) / 86_400_000) + 1;
}

function pointExists(slug: string): boolean {
  return getDb().prepare(`SELECT 1 FROM points WHERE slug = ?`).get(slug) != null;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
