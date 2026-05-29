import { getDb, pruneOldData } from "../db";
import { config } from "../config";
import {
  resolvePoint,
  fetchGridpointForecast,
  fetchLatestObservation,
  type ForecastHour,
  type LatestObservation,
} from "../nws/client";
import {
  findNearestStation,
  fetchLatestObservations,
  type SynopticObservation,
} from "../synoptic/client";

interface PointRow {
  slug: string;
  latitude: number;
  longitude: number;
  grid_id: string | null;
  grid_x: number | null;
  grid_y: number | null;
  observation_station_id: string | null;
  synoptic_station_id: string | null;
  synoptic_resolved_at: string | null;
}

// Run a single poll cycle across all configured points.
export async function poll(): Promise<{ forecasts: number; observations: number }> {
  const db = getDb();
  const points = db
    .prepare(
      `SELECT slug, latitude, longitude, grid_id, grid_x, grid_y,
              observation_station_id, synoptic_station_id, synoptic_resolved_at
       FROM points`
    )
    .all() as PointRow[];

  if (points.length === 0) {
    console.warn("No points configured — skipping poll.");
    return { forecasts: 0, observations: 0 };
  }

  console.log(`Polling ${points.length} points...`);
  let forecastCount = 0;
  let obsCount = 0;

  for (const point of points) {
    try {
      const resolved = await ensureResolved(point);
      forecastCount += await pollForecast(point.slug, resolved);
      obsCount += await pollObservation(point.slug, resolved.observation_station_id);
    } catch (err) {
      console.error(`  ${point.slug}: ${(err as Error).message}`);
    }
  }

  const pruned = pruneOldData();
  console.log(
    `Stored ${forecastCount} forecast hours, ${obsCount} new observations at ${new Date().toISOString()}`
  );
  if (pruned.forecasts > 0 || pruned.observations > 0) {
    console.log(
      `Pruned ${pruned.forecasts} past forecast hours, ${pruned.observations} old observations`
    );
  }
  return { forecasts: forecastCount, observations: obsCount };
}

// Resolve a point's NWS grid + nearest station once, then cache it.
async function ensureResolved(point: PointRow): Promise<PointRow> {
  if (point.grid_id != null) return point;

  const r = await resolvePoint(point.latitude, point.longitude);
  getDb()
    .prepare(
      `UPDATE points SET grid_id = ?, grid_x = ?, grid_y = ?,
         observation_station_id = ?, resolved_at = ? WHERE slug = ?`
    )
    .run(r.gridId, r.gridX, r.gridY, r.stationId, new Date().toISOString(), point.slug);

  return {
    ...point,
    grid_id: r.gridId,
    grid_x: r.gridX,
    grid_y: r.gridY,
    observation_station_id: r.stationId,
  };
}

async function pollForecast(slug: string, p: PointRow): Promise<number> {
  if (p.grid_id == null || p.grid_x == null || p.grid_y == null) return 0;

  const hours = await fetchGridpointForecast(
    p.grid_id,
    p.grid_x,
    p.grid_y,
    config.forecastHours
  );
  return writeForecast(slug, hours);
}

function writeForecast(slug: string, hours: ForecastHour[]): number {
  const db = getDb();
  const now = new Date().toISOString();

  const upsert = db.prepare(`
    INSERT INTO forecasts (
      point_slug, valid_time, fetched_at, air_temp, wind_speed, wind_gust,
      wind_direction, precip_prob, relative_humidity, snowfall_amount,
      snow_level, sky_cover
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(point_slug, valid_time) DO UPDATE SET
      fetched_at = excluded.fetched_at,
      air_temp = excluded.air_temp,
      wind_speed = excluded.wind_speed,
      wind_gust = excluded.wind_gust,
      wind_direction = excluded.wind_direction,
      precip_prob = excluded.precip_prob,
      relative_humidity = excluded.relative_humidity,
      snowfall_amount = excluded.snowfall_amount,
      snow_level = excluded.snow_level,
      sky_cover = excluded.sky_cover
  `);

  const tx = db.transaction(() => {
    for (const h of hours) {
      upsert.run(
        slug, h.validTime, now, h.airTemp, h.windSpeed, h.windGust,
        h.windDirection, h.precipProb, h.relativeHumidity, h.snowfallAmount,
        h.snowLevel, h.skyCover
      );
    }
  });
  tx();
  return hours.length;
}

async function pollObservation(slug: string, stationId: string | null): Promise<number> {
  if (!stationId) return 0;

  const obs = await fetchLatestObservation(stationId);
  if (!obs) return 0;
  return writeObservation(slug, stationId, obs);
}

function writeObservation(slug: string, stationId: string, obs: LatestObservation): number {
  const result = getDb()
    .prepare(
      `INSERT INTO observations (
         point_slug, station_id, observed_at, polled_at, air_temp, wind_speed,
         wind_gust, wind_direction, relative_humidity, precip_last_hour, snow_depth
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(point_slug, observed_at) DO NOTHING`
    )
    .run(
      slug, stationId, obs.observedAt, new Date().toISOString(), obs.airTemp,
      obs.windSpeed, obs.windGust, obs.windDirection, obs.relativeHumidity,
      obs.precipLastHour, obs.snowDepth
    );
  return result.changes > 0 ? 1 : 0;
}

// --- Synoptic polling -------------------------------------------------------

// Resolve the nearest Synoptic station for every un-searched point, then
// batch-fetch latest observations for all points that have one. All station
// lookups for a poll cycle are combined into a single API call to minimise
// service-unit consumption on the free tier.
export async function pollSynopticObservations(): Promise<number> {
  if (!config.synopticApiToken) return 0;

  const db = getDb();
  const points = db
    .prepare(
      `SELECT slug, latitude, longitude, synoptic_station_id, synoptic_resolved_at
       FROM points`
    )
    .all() as Pick<PointRow, "slug" | "latitude" | "longitude" | "synoptic_station_id" | "synoptic_resolved_at">[];

  // Resolve points not yet searched, plus any "no station" results older than
  // 7 days (new stations get installed, or a wider radius may help).
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const unresolved = points.filter(
    (p) =>
      p.synoptic_resolved_at == null ||
      (p.synoptic_station_id == null && p.synoptic_resolved_at < sevenDaysAgo)
  );
  if (unresolved.length > 0) {
    console.log(`Resolving Synoptic stations for ${unresolved.length} points...`);
    for (const p of unresolved) {
      await resolveSynopticStation(p);
    }
  }

  // Collect all points that have a Synoptic station.
  const covered = db
    .prepare(`SELECT slug, synoptic_station_id FROM points WHERE synoptic_station_id IS NOT NULL`)
    .all() as { slug: string; synoptic_station_id: string }[];

  if (covered.length === 0) {
    console.log("No Synoptic stations found for any configured point.");
    return 0;
  }

  console.log(`Polling Synoptic for ${covered.length} stations...`);
  const stidToSlug = Object.fromEntries(covered.map((p) => [p.synoptic_station_id, p.slug]));

  try {
    const observations = await fetchLatestObservations(covered.map((p) => p.synoptic_station_id));
    let count = 0;
    for (const obs of observations) {
      const slug = stidToSlug[obs.stid];
      if (!slug) continue;
      count += writeSynopticObservation(slug, obs);
    }
    console.log(`Stored ${count} new Synoptic observations at ${new Date().toISOString()}`);
    return count;
  } catch (err) {
    console.error(`Synoptic poll failed: ${(err as Error).message}`);
    return 0;
  }
}

async function resolveSynopticStation(
  point: Pick<PointRow, "slug" | "latitude" | "longitude">
): Promise<void> {
  let station: Awaited<ReturnType<typeof findNearestStation>>;
  try {
    station = await findNearestStation(
      point.latitude,
      point.longitude,
      config.synopticRadiusMiles
    );
  } catch (err) {
    // API failure (auth, network, etc.): leave synoptic_resolved_at as NULL
    // so this point is retried on the next poll cycle.
    console.warn(`  ${point.slug}: Synoptic lookup failed — ${(err as Error).message}`);
    return;
  }

  // Only reach here on a successful API response (station found or genuinely
  // no coverage). Stamp synoptic_resolved_at so we don't re-query every cycle.
  getDb()
    .prepare(
      `UPDATE points SET synoptic_station_id = ?, synoptic_resolved_at = ? WHERE slug = ?`
    )
    .run(station?.stid ?? null, new Date().toISOString(), point.slug);

  if (station) {
    console.log(`  ${point.slug}: Synoptic → ${station.stid} (${station.name}, elev ${station.elevation} ft)`);
  } else {
    console.log(`  ${point.slug}: no Synoptic station within ${config.synopticRadiusMiles} miles`);
  }
}

function writeSynopticObservation(slug: string, obs: SynopticObservation): number {
  const result = getDb()
    .prepare(
      `INSERT INTO observations (
         point_slug, station_id, observed_at, polled_at, air_temp, wind_speed,
         wind_gust, wind_direction, relative_humidity, precip_last_hour, snow_depth, source
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synoptic')
       ON CONFLICT(point_slug, observed_at) DO NOTHING`
    )
    .run(
      slug, obs.stid, obs.observedAt, new Date().toISOString(),
      obs.airTemp, obs.windSpeed, obs.windGust, obs.windDirection,
      obs.relativeHumidity, obs.precipLastHour, obs.snowDepth
    );
  return result.changes > 0 ? 1 : 0;
}
