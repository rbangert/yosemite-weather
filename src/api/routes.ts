import { getDb } from "../db";
import { areas } from "../config";

export function handleRequest(req: Request): Response {
  const url = new URL(req.url);
  const { pathname } = url;

  if (pathname === "/health") return json({ status: "ok" });
  if (pathname === "/api/areas") return json(areas);
  if (pathname === "/api/overview") return handleOverview();

  const forecast = pathname.match(/^\/api\/points\/([^/]+)\/forecast$/);
  if (forecast) {
    const hours = Number(url.searchParams.get("hours") ?? "24");
    return handleForecast(forecast[1], hours);
  }

  const latest = pathname.match(/^\/api\/points\/([^/]+)\/observations\/latest$/);
  if (latest) return handleLatestObservation(latest[1]);

  return json({ error: "Not found" }, 404);
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

function pointExists(slug: string): boolean {
  return getDb().prepare(`SELECT 1 FROM points WHERE slug = ?`).get(slug) != null;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
