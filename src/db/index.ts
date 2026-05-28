import { Database } from "bun:sqlite";
import { config, getAllPoints } from "../config";
import { mkdirSync } from "fs";
import { dirname } from "path";

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    mkdirSync(dirname(config.dbPath), { recursive: true });
    db = new Database(config.dbPath, { create: true });
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
  }
  return db;
}

export function setupSchema(): void {
  const db = getDb();

  // Monitored locations. grid_* and observation_station_id are cached after
  // the first NWS lookup so we don't re-resolve every poll.
  db.run(`
    CREATE TABLE IF NOT EXISTS points (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      area_slug TEXT NOT NULL,
      area_name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      grid_id TEXT,
      grid_x INTEGER,
      grid_y INTEGER,
      observation_station_id TEXT,
      resolved_at TEXT
    )
  `);

  // Hourly NWS gridpoint forecast, stored in English units. Forecasts get
  // revised, so polling upserts on (point_slug, valid_time).
  db.run(`
    CREATE TABLE IF NOT EXISTS forecasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      point_slug TEXT NOT NULL,
      valid_time TEXT NOT NULL,          -- ISO 8601 hour the forecast is for (UTC)
      fetched_at TEXT NOT NULL,
      air_temp REAL,                     -- °F
      wind_speed REAL,                   -- mph
      wind_gust REAL,                    -- mph
      wind_direction REAL,               -- degrees
      precip_prob REAL,                  -- %
      relative_humidity REAL,            -- %
      snowfall_amount REAL,              -- inches (this hour)
      snow_level REAL,                   -- feet
      sky_cover REAL,                    -- %
      FOREIGN KEY (point_slug) REFERENCES points(slug),
      UNIQUE(point_slug, valid_time)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_forecast_point_time
    ON forecasts(point_slug, valid_time)
  `);

  // Latest measured conditions from the nearest NWS station, where one exists.
  db.run(`
    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      point_slug TEXT NOT NULL,
      station_id TEXT NOT NULL,
      observed_at TEXT NOT NULL,         -- ISO 8601 timestamp from the station
      polled_at TEXT NOT NULL,
      air_temp REAL,                     -- °F
      wind_speed REAL,                   -- mph
      wind_gust REAL,                    -- mph
      wind_direction REAL,               -- degrees
      relative_humidity REAL,            -- %
      precip_last_hour REAL,             -- inches
      FOREIGN KEY (point_slug) REFERENCES points(slug),
      UNIQUE(point_slug, observed_at)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_obs_point_time
    ON observations(point_slug, observed_at DESC)
  `);

  seedPoints();
  console.log("Database schema initialized at", config.dbPath);
}

// Insert configured points, preserving any cached grid/station resolution.
function seedPoints(): void {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO points (slug, name, area_slug, area_name, latitude, longitude)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      area_slug = excluded.area_slug,
      area_name = excluded.area_name,
      latitude = excluded.latitude,
      longitude = excluded.longitude
  `);

  const tx = db.transaction(() => {
    for (const p of getAllPoints()) {
      upsert.run(p.slug, p.name, p.areaSlug, p.areaName, p.latitude, p.longitude);
    }
  });
  tx();
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
