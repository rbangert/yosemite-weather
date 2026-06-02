import { getDb, pruneOldData } from "../db";
import { config } from "../config";
import {
  resolvePoint,
  fetchGridpointForecast,
  fetchPeriodForecast,
  fetchLatestObservation,
  fetchActiveAlerts,
  fetchAreaForecastDiscussion,
  type ForecastHour,
  type ForecastPeriod,
  type LatestObservation,
  type NwsAlert,
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
      await pollPeriodForecast(point.slug, resolved);
      obsCount += await pollObservation(point.slug, resolved.observation_station_id);
    } catch (err) {
      console.error(`  ${point.slug}: ${(err as Error).message}`);
    }
  }

  const alertCount = await pollAlerts();
  await pollDiscussions();

  const pruned = pruneOldData();
  console.log(
    `Stored ${forecastCount} forecast hours, ${obsCount} new observations, ${alertCount} alerts at ${new Date().toISOString()}`
  );
  if (pruned.forecasts > 0 || pruned.observations > 0 || pruned.alerts > 0) {
    console.log(
      `Pruned ${pruned.forecasts} past forecast hours, ${pruned.observations} old observations, ${pruned.alerts} expired alerts`
    );
  }
  return { forecasts: forecastCount, observations: obsCount, alerts: alertCount };
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
      point_slug, valid_time, fetched_at, air_temp, apparent_temp, dewpoint, wind_speed, wind_gust,
      wind_direction, precip_prob, thunder_prob, relative_humidity, snowfall_amount,
      snow_level, sky_cover
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(point_slug, valid_time) DO UPDATE SET
      fetched_at = excluded.fetched_at,
      air_temp = excluded.air_temp,
      apparent_temp = excluded.apparent_temp,
      dewpoint = excluded.dewpoint,
      wind_speed = excluded.wind_speed,
      wind_gust = excluded.wind_gust,
      wind_direction = excluded.wind_direction,
      precip_prob = excluded.precip_prob,
      thunder_prob = excluded.thunder_prob,
      relative_humidity = excluded.relative_humidity,
      snowfall_amount = excluded.snowfall_amount,
      snow_level = excluded.snow_level,
      sky_cover = excluded.sky_cover
  `);

  const tx = db.transaction(() => {
    for (const h of hours) {
      upsert.run(
        slug, h.validTime, now, h.airTemp, h.apparentTemp, h.dewpoint, h.windSpeed, h.windGust,
        h.windDirection, h.precipProb, h.thunderProb, h.relativeHumidity,
        h.snowfallAmount, h.snowLevel, h.skyCover
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

// --- Period forecast polling ------------------------------------------------

async function pollPeriodForecast(slug: string, p: PointRow): Promise<void> {
  if (p.grid_id == null || p.grid_x == null || p.grid_y == null) return;
  try {
    const periods = await fetchPeriodForecast(p.grid_id, p.grid_x, p.grid_y);
    writePeriodForecast(slug, periods);
  } catch (err) {
    // Period forecast is best-effort; don't abort the poll cycle on failure.
    console.warn(`  ${slug}: period forecast failed — ${(err as Error).message}`);
  }
}

function writePeriodForecast(slug: string, periods: ForecastPeriod[]): void {
  const db = getDb();
  const now = new Date().toISOString();

  // NWS silently shifts period start_times between polls (e.g. "Today" moves
  // from T08:00 → T11:00 as time passes). An upsert keyed on start_time leaves
  // the old row untouched, so stale rows accumulate and the same calendar day
  // can appear 3–4 times in the table. Fix: delete all rows for this point
  // inside the transaction and insert the fresh set wholesale.
  const insert = db.prepare(`
    INSERT INTO period_forecasts (
      point_slug, period_number, name, start_time, end_time, is_daytime,
      temperature, wind_speed, wind_direction, precip_prob,
      short_forecast, detailed_forecast, icon_url, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM period_forecasts WHERE point_slug = ?`).run(slug);
    for (const p of periods) {
      insert.run(
        slug, p.number, p.name, p.startTime, p.endTime,
        p.isDaytime ? 1 : 0, p.temperature, p.windSpeed, p.windDirection,
        p.precipProb, p.shortForecast, p.detailedForecast, p.iconUrl, now
      );
    }
  });
  tx();
}

// --- Alert polling ----------------------------------------------------------

async function pollAlerts(): Promise<number> {
  if (config.alertZones.length === 0) return 0;
  try {
    const alerts = await fetchActiveAlerts(config.alertZones);
    return writeAlerts(alerts);
  } catch (err) {
    console.error(`Alert poll failed: ${(err as Error).message}`);
    return 0;
  }
}

function writeAlerts(alerts: NwsAlert[]): number {
  const db = getDb();
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO alerts (
      id, event, severity, urgency, certainty, headline, description,
      instruction, area_desc, effective, onset, expires, ends, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      event = excluded.event,
      severity = excluded.severity,
      urgency = excluded.urgency,
      certainty = excluded.certainty,
      headline = excluded.headline,
      description = excluded.description,
      instruction = excluded.instruction,
      area_desc = excluded.area_desc,
      effective = excluded.effective,
      onset = excluded.onset,
      expires = excluded.expires,
      ends = excluded.ends,
      fetched_at = excluded.fetched_at
  `);

  const tx = db.transaction(() => {
    for (const a of alerts) {
      upsert.run(
        a.id, a.event, a.severity, a.urgency, a.certainty, a.headline,
        a.description, a.instruction, a.areaDesc, a.effective, a.onset,
        a.expires, a.ends, now
      );
    }
  });
  tx();
  return alerts.length;
}

// --- Forecast discussion polling --------------------------------------------

// Fetch the latest Area Forecast Discussion for every distinct NWS office among
// our resolved points (typically HNX + REV) and upsert one row per office.
// Best-effort: a failure for one office never aborts the poll cycle.
async function pollDiscussions(): Promise<void> {
  const db = getDb();
  const offices = db
    .prepare(`SELECT DISTINCT grid_id FROM points WHERE grid_id IS NOT NULL`)
    .all() as { grid_id: string }[];

  for (const { grid_id } of offices) {
    try {
      const afd = await fetchAreaForecastDiscussion(grid_id);
      if (afd) writeDiscussion(afd.office, afd.issuanceTime, afd.text);
    } catch (err) {
      console.warn(`  ${grid_id}: forecast discussion failed — ${(err as Error).message}`);
    }
  }
}

function writeDiscussion(office: string, issuanceTime: string, text: string): void {
  getDb()
    .prepare(
      `INSERT INTO forecast_discussions (office, issuance_time, product_text, fetched_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(office) DO UPDATE SET
         issuance_time = excluded.issuance_time,
         product_text = excluded.product_text,
         fetched_at = excluded.fetched_at`
    )
    .run(office, issuanceTime, text, new Date().toISOString());
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
