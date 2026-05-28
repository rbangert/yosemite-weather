# Yosemite Weather Backend

Bun-based backend that polls the [NWS / NOAA API](https://www.weather.gov/documentation/services-web-api)
for Yosemite National Park locations and serves the data over a REST API backed by SQLite.

For each configured point it collects:

- **Forecasts** — NWS gridpoint hourly forecast (temperature, wind, gusts, precip
  probability, humidity, snowfall, snow level, sky cover). Available for every point.
- **Observations** — latest measured conditions from the nearest NWS station,
  where one exists (many backcountry points have a nearby RAWS station).

The NWS API is free and requires no token — only a `User-Agent` header identifying
the app and a contact email.

## Setup

```bash
# Install dependencies
bun install

# Copy and configure environment variables
cp .env.example .env
# Edit .env and set CONTACT_EMAIL (used in the NWS User-Agent)

# Initialize the database and seed points
bun run db:setup
```

## Running

```bash
# Start API server + polling loop (with hot reload)
bun run dev

# Or without hot reload
bun run start

# Run a one-off poll manually
bun run poll
```

On the first poll, each point is resolved to its NWS forecast grid and nearest
observation station; the resolution is cached in the database so later polls skip it.

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/areas` | List all areas and their points |
| `GET /api/overview` | Current-hour forecast + latest observation for every point, grouped by area |
| `GET /api/points/:slug/forecast?hours=24` | Hourly forecast for the next N hours |
| `GET /api/points/:slug/observations/latest` | Most recent observation (if a station is available) |
| `GET /health` | Health check |

Units are English: °F, mph, inches, feet, percent, degrees.

## Data Model

The schema lives in `src/db/index.ts`. Three SQLite tables, all storing English
units. Any numeric weather field may be `null` when NWS has no value for it.

### `points`

One row per monitored location (seeded from `src/config/index.ts` on `db:setup`).
The `grid_*` and `observation_station_id` columns are filled lazily on the first
poll — each point is resolved to its NWS forecast grid and nearest station once,
then cached so later polls skip the lookup.

| Column | Type | Notes |
|---|---|---|
| `slug` | TEXT, PK | Stable identifier, e.g. `tuolumne-meadows` |
| `name` | TEXT | Display name |
| `area_slug` / `area_name` | TEXT | The region grouping from config |
| `latitude` / `longitude` | REAL | Coordinates polled from NWS |
| `grid_id` | TEXT, nullable | NWS forecast office, e.g. `HNX` (cached) |
| `grid_x` / `grid_y` | INTEGER, nullable | NWS grid cell (cached) |
| `observation_station_id` | TEXT, nullable | Nearest station, e.g. `TUMC1` (cached; `null` if none) |
| `resolved_at` | TEXT, nullable | ISO timestamp of the grid/station lookup |

### `forecasts`

Hourly NWS gridpoint forecast. One row per `(point, hour)`. Polling **upserts** on
`(point_slug, valid_time)` because NWS revises forecasts — re-polling overwrites a
given hour with the newest values. Retention horizon is `FORECAST_HOURS` (default 72).

| Column | Type | Unit |
|---|---|---|
| `id` | INTEGER, PK | — |
| `point_slug` | TEXT, FK → `points.slug` | — |
| `valid_time` | TEXT | ISO 8601 hour the forecast is for (UTC) |
| `fetched_at` | TEXT | ISO timestamp the row was last written |
| `air_temp` | REAL | °F |
| `wind_speed` / `wind_gust` | REAL | mph |
| `wind_direction` | REAL | degrees |
| `precip_prob` | REAL | % |
| `relative_humidity` | REAL | % |
| `snowfall_amount` | REAL | inches (this hour) |
| `snow_level` | REAL | feet |
| `sky_cover` | REAL | % |

Unique: `(point_slug, valid_time)`.

### `observations`

Latest measured conditions from a point's nearest NWS station. One row per
`(point, observation timestamp)`; polling inserts with `ON CONFLICT DO NOTHING`,
so a row only appears when the station publishes a new reading (roughly hourly).
Multiple points can share a station (e.g. several Tuolumne-area points use `TUMC1`),
in which case each point gets its own row referencing the same `station_id`.

| Column | Type | Unit |
|---|---|---|
| `id` | INTEGER, PK | — |
| `point_slug` | TEXT, FK → `points.slug` | — |
| `station_id` | TEXT | NWS station that produced the reading |
| `observed_at` | TEXT | ISO timestamp from the station |
| `polled_at` | TEXT | ISO timestamp we fetched it |
| `air_temp` | REAL | °F |
| `wind_speed` / `wind_gust` | REAL | mph |
| `wind_direction` | REAL | degrees |
| `relative_humidity` | REAL | % |
| `precip_last_hour` | REAL | inches |

Unique: `(point_slug, observed_at)`.

### Retention

At the end of every poll cycle, old data is pruned to keep both tables bounded:

- **Forecasts** — rows whose `valid_time` is now in the past are deleted (the
  forward horizon is already capped by `FORECAST_HOURS`).
- **Observations** — rows older than `OBSERVATION_RETENTION_DAYS` (default 30) are deleted.

### API response shapes

`GET /api/areas` returns the config as-is: an array of areas, each with a `points`
array of `{ slug, name, latitude, longitude }`.

`GET /api/overview` groups points by area and pairs each with its current data:

```jsonc
[
  {
    "slug": "high-country",
    "name": "High Country (Tuolumne & Tioga)",
    "points": [
      {
        "slug": "tuolumne-meadows",
        "name": "Tuolumne Meadows",
        "forecast":    { /* forecast row for the current hour, or null */ },
        "observation": { /* latest observations row, or null */ }
      }
    ]
  }
]
```

`GET /api/points/:slug/forecast?hours=N` returns an array of forecast rows (the
table columns above, minus `id`/`point_slug`/`fetched_at`) from now through N hours.

`GET /api/points/:slug/observations/latest` returns a single observations row, or
`404` if the point has no station / no readings yet.

## Configuration

Points and areas are defined in `src/config/index.ts`. Each point is a name +
latitude/longitude; edit the `areas` array to add or regroup locations. Coordinates
for the default Yosemite set come from `locations.md`.

## Project Structure

```
src/
├── index.ts            # Entry point — starts API + polling loop
├── config/
│   └── index.ts        # Env vars, point/area definitions
├── api/
│   ├── server.ts       # Bun.serve HTTP server
│   └── routes.ts       # Route handlers
├── db/
│   ├── index.ts        # Connection, schema, point seeding
│   └── setup.ts        # DB initialization script
├── nws/
│   └── client.ts       # NWS API client (resolve, forecast, observations)
└── poller/
    ├── index.ts        # Poll cycle — fetch + write to DB
    └── poll.ts         # Standalone poll script
```

## Roadmap

- Synoptic Data API integration for wind data not available through NWS.
