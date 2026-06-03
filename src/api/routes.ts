import { getDb } from "../db";
import { areas, config, avalancheZones } from "../config";
import { WIND_STATIONS } from "../wind/stations";
import { computeWindLoading, type WindObs, type Severity } from "../wind/transport";

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

  const discussion = pathname.match(/^\/api\/points\/([^/]+)\/forecast\/discussion$/);
  if (discussion) return handleDiscussion(discussion[1]);

  if (pathname === "/api/alerts") return handleAlerts();
  if (pathname === "/api/wind-loading") return handleWindLoading();
  if (pathname === "/api/data-explorer") return handleDataExplorer();
  if (pathname === "/api/swe") return handleSweStations();

  const sweStation = pathname.match(/^\/api\/swe\/([^/]+)$/);
  if (sweStation) return handleSwe(sweStation[1]);

  if (pathname === "/api/avalanche") return handleAvalancheZones();
  const avalancheZone = pathname.match(/^\/api\/avalanche\/([^/]+)$/);
  if (avalancheZone) return handleAvalancheForecast(avalancheZone[1]);

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
      `SELECT valid_time, air_temp, apparent_temp, dewpoint, wind_speed, wind_gust, wind_direction,
              precip_prob, thunder_prob, relative_humidity, snowfall_amount, snow_level, sky_cover
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

// Latest Area Forecast Discussion for the point's NWS office (grid_id).
function handleDiscussion(slug: string): Response {
  const db = getDb();
  const point = db.prepare(`SELECT grid_id FROM points WHERE slug = ?`).get(slug) as
    | { grid_id: string | null }
    | undefined;
  if (!point) return json({ error: "Unknown point" }, 404);
  if (!point.grid_id) return json({ error: "Point not yet resolved" }, 404);

  const row = db
    .prepare(
      `SELECT office, issuance_time, product_text, fetched_at
       FROM forecast_discussions WHERE office = ?`
    )
    .get(point.grid_id);

  if (!row) return json({ error: "No forecast discussion available" }, 404);
  return json(row);
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

// Wind-transported-snow / loading index for the high-elevation stations.
// For each fixed station: pull the recent obs window, decide whether transportable
// snow exists (recent SWE gain at the nearest SNOTEL site + cold), and compute the
// Snow Transport Index, drift rose, and resultant lee-loading direction.
const SEVERITY_RANK: Record<Severity, number> = { None: 0, Light: 1, Moderate: 2, Intense: 3 };

function handleWindLoading(): Response {
  const db = getDb();
  const windowStart = new Date(
    Date.now() - config.windLoadingWindowHours * 3_600_000
  ).toISOString();

  const obsStmt = db.prepare(
    `SELECT observed_at, wind_speed, wind_gust, wind_direction, air_temp, source
     FROM wind_station_obs
     WHERE station_id = ? AND observed_at >= ?
     ORDER BY observed_at ASC`
  );

  const stations = WIND_STATIONS.map((s) => {
    const rows = obsStmt.all(s.id, windowStart) as {
      observed_at: string;
      wind_speed: number | null;
      wind_gust: number | null;
      wind_direction: number | null;
      air_temp: number | null;
      source: string;
    }[];

    const obs: WindObs[] = rows.map((r) => ({
      observedAt: r.observed_at,
      windSpeedMph: r.wind_speed,
      windGustMph: r.wind_gust,
      windDirectionDeg: r.wind_direction,
      airTempF: r.air_temp,
    }));

    const snow = snowAvailability(s.snotelId);
    const loading = computeWindLoading(obs, {
      snowAvailable: snow.available,
      thresholds: s.severity,
    });

    return {
      id: s.id,
      name: s.name,
      elevationFt: s.elevationFt,
      hasGust: s.hasGust,
      snotelId: s.snotelId,
      source: rows.at(-1)?.source ?? null,
      newSnowInches: snow.gainInches,
      ...loading,
    };
  });

  // Area roll-up: worst severity and the lee direction of the most-loaded station.
  const withData = stations.filter((s) => s.obsCount > 0);
  const worst = withData.reduce<(typeof stations)[number] | null>(
    (acc, s) => (acc == null || SEVERITY_RANK[s.severity] > SEVERITY_RANK[acc.severity] ? s : acc),
    null
  );

  return json({
    windowHours: config.windLoadingWindowHours,
    thresholdMph: 13.4,
    summary: worst
      ? { severity: worst.severity, leeDirection: worst.leeDirection, drivenBy: worst.name }
      : { severity: "None", leeDirection: null, drivenBy: null },
    stations,
  });
}

// Whether loose, transportable snow likely exists near a SNOTEL site: a recent
// net SWE gain (new snow) over the last few days. Melting/calm periods → false,
// which closes the transport gate even when winds are strong.
function snowAvailability(snotelId: string): { available: boolean; gainInches: number } {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT value_in FROM swe_readings
       WHERE station_id = ? AND value_in IS NOT NULL
       ORDER BY date DESC LIMIT 5`
    )
    .all(snotelId) as { value_in: number }[];

  if (rows.length < 2) return { available: false, gainInches: 0 };
  const latest = rows[0].value_in;
  const earliest = rows[rows.length - 1].value_in;
  const gain = Math.round((latest - earliest) * 100) / 100;
  return { available: gain >= 0.2, gainInches: gain };
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

  // Group every reading by water year (day-of-water-year is the chart x-axis).
  const byYear: Record<number, { day: number; date: string; value: number | null }[]> = {};
  for (const row of rows) {
    const wy = Number(toWaterYear(row.date));
    const day = toWaterYearDay(row.date);
    (byYear[wy] ??= []).push({ day, date: row.date, value: row.value_in });
  }

  const now = new Date();
  const currentWy = now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();

  // Per-day mean SWE over the N most recent COMPLETE water years (the current,
  // partial year is excluded so late-season values aren't biased downward).
  // CDEC sensor noise (negatives, > 90") is dropped before averaging.
  const meanByDay = (n: number) => {
    const sums = new Float64Array(367);
    const counts = new Int32Array(367);
    for (let wy = currentWy - n; wy <= currentWy - 1; wy++) {
      for (const p of byYear[wy] ?? []) {
        if (p.value == null || p.value < 0 || p.value > 90) continue;
        if (p.day >= 1 && p.day <= 366) { sums[p.day] += p.value; counts[p.day]++; }
      }
    }
    const out: { day: number; value: number }[] = [];
    for (let day = 1; day <= 366; day++) {
      if (counts[day] > 0) out.push({ day, value: Math.round((sums[day] / counts[day]) * 100) / 100 });
    }
    return out;
  };

  // Individual year lines: the 10 most recent water years.
  const recentKeys = Object.keys(byYear).map(Number).sort((a, b) => a - b).slice(-10);
  const waterYears: Record<string, { day: number; date: string; value: number | null }[]> = {};
  for (const wy of recentKeys) waterYears[wy] = byYear[wy];

  return json({
    station,
    waterYears,
    averages: { '10': meanByDay(10), '20': meanByDay(20) },
  });
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

// All neighboring avalanche zones — compact summary for the overview cards.
// Ordered to match the configured zone list (closest to the park first).
function handleAvalancheZones(): Response {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT center_id, zone_id, zone_name, product_type, off_season,
              danger_level, published_time, expires_time, link, fetched_at
       FROM avalanche_forecasts`
    )
    .all() as any[];

  const byKey = new Map(rows.map((r) => [`${r.center_id}:${r.zone_id}`, r]));
  const zones = avalancheZones.map((z) => {
    const r = byKey.get(`${z.centerId}:${z.zoneId}`);
    return {
      centerId: z.centerId,
      zoneId: z.zoneId,
      name: z.name,
      relation: z.relation,
      productType: r?.product_type ?? null,
      offSeason: r ? Boolean(r.off_season) : null,
      dangerLevel: r?.danger_level ?? -1,
      publishedTime: r?.published_time ?? null,
      expiresTime: r?.expires_time ?? null,
      link: r?.link ?? null,
      fetchedAt: r?.fetched_at ?? null,
    };
  });

  return json(zones);
}

// Full normalized forecast for one zone, keyed by center id (zones are 1:1 with
// centers here). Parses the stored danger/problems JSON back into objects.
function handleAvalancheForecast(centerId: string): Response {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT center_id, zone_id, zone_name, product_type, off_season, danger_level,
              published_time, expires_time, author, bottom_line, hazard_discussion,
              weather_discussion, danger_json, problems_json, link, fetched_at
       FROM avalanche_forecasts WHERE center_id = ?`
    )
    .get(centerId.toUpperCase()) as any;

  if (!row) return json({ error: "Unknown avalanche center" }, 404);

  const meta = avalancheZones.find((z) => z.centerId === row.center_id);
  return json({
    centerId: row.center_id,
    zoneId: row.zone_id,
    name: row.zone_name,
    relation: meta?.relation ?? null,
    productType: row.product_type,
    offSeason: Boolean(row.off_season),
    dangerLevel: row.danger_level,
    publishedTime: row.published_time,
    expiresTime: row.expires_time,
    author: row.author,
    bottomLine: row.bottom_line,
    hazardDiscussion: row.hazard_discussion,
    weatherDiscussion: row.weather_discussion,
    danger: safeParse(row.danger_json, []),
    problems: safeParse(row.problems_json, []),
    link: row.link,
    fetchedAt: row.fetched_at,
  });
}

function safeParse<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
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
