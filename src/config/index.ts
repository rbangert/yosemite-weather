// Environment configuration
export const config = {
  // NWS API requires a descriptive User-Agent with contact info.
  nwsBaseUrl: "https://api.weather.gov",
  nwsUserAgent:
    process.env.NWS_USER_AGENT ??
    `yosemite-weather (${process.env.CONTACT_EMAIL ?? "anonymous@example.com"})`,
  dbPath: process.env.DB_PATH ?? "data/weather.db",
  apiPort: Number(process.env.API_PORT) || 3000,
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 15 * 60 * 1000, // 15 minutes
  // How many hours of hourly forecast to retain per point.
  forecastHours: Number(process.env.FORECAST_HOURS) || 72,
  // How many days of past observations to retain.
  observationRetentionDays: Number(process.env.OBSERVATION_RETENTION_DAYS) || 30,
  // Retry transient NWS failures (5xx/429/network) with exponential backoff.
  retryMaxAttempts: Number(process.env.NWS_RETRY_MAX_ATTEMPTS) || 3,
  retryBaseDelayMs: Number(process.env.NWS_RETRY_BASE_DELAY_MS) || 500,
};

// A monitored location, identified by coordinates. NWS resolves these to a
// forecast gridpoint (for forecasts) and a nearest station (for observations).
export interface PointConfig {
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface AreaConfig {
  slug: string;
  name: string;
  points: PointConfig[];
}

// Yosemite National Park locations, grouped into rough regions.
// Coordinates from locations.md. Edit freely to add or regroup points.
export const areas: AreaConfig[] = [
  {
    slug: "valley-west",
    name: "Valley & West",
    points: [
      { slug: "big-oak-flat-entrance", name: "Big Oak Flat Entrance", latitude: 37.80838, longitude: -119.87183 },
      { slug: "crane-flat", name: "Crane Flat", latitude: 37.75248, longitude: -119.79853 },
      { slug: "hodgdon-meadow", name: "Hodgdon Meadow", latitude: 37.80838, longitude: -119.87183 },
      { slug: "mather", name: "Mather", latitude: 37.88136, longitude: -119.85707 },
      { slug: "el-portal", name: "El Portal", latitude: 37.66938, longitude: -119.81329 },
      { slug: "yosemite-valley", name: "Yosemite Valley", latitude: 37.74539, longitude: -119.59244 },
      { slug: "little-yosemite-valley", name: "Little Yosemite Valley", latitude: 37.73231, longitude: -119.5151 },
    ],
  },
  {
    slug: "south",
    name: "South (Wawona & Glacier Point)",
    points: [
      { slug: "badger-pass", name: "Badger Pass", latitude: 37.66183, longitude: -119.66195 },
      { slug: "bridalveil-creek", name: "Bridalveil Creek", latitude: 37.6639, longitude: -119.6223 },
      { slug: "chinquapin", name: "Chinquapin", latitude: 37.65225, longitude: -119.70323 },
      { slug: "glacier-point", name: "Glacier Point", latitude: 37.72725, longitude: -119.575 },
      { slug: "fish-camp", name: "Fish Camp", latitude: 37.48176, longitude: -119.63606 },
      { slug: "mariposa-grove", name: "Mariposa Grove", latitude: 37.50387, longitude: -119.60039 },
      { slug: "south-entrance", name: "South Entrance", latitude: 37.50655, longitude: -119.63183 },
      { slug: "wawona", name: "Wawona", latitude: 37.53845, longitude: -119.65851 },
    ],
  },
  {
    slug: "high-country",
    name: "High Country (Tuolumne & Tioga)",
    points: [
      { slug: "glen-aulin", name: "Glen Aulin", latitude: 37.91074, longitude: -119.42175 },
      { slug: "may-lake", name: "May Lake", latitude: 37.84424, longitude: -119.4923 },
      { slug: "merced-lake", name: "Merced Lake", latitude: 37.7391, longitude: -119.41313 },
      { slug: "porcupine-flat", name: "Porcupine Flat", latitude: 37.81421, longitude: -119.56692 },
      { slug: "tenaya-lake", name: "Tenaya Lake", latitude: 37.83054, longitude: -119.46255 },
      { slug: "tioga-pass", name: "Tioga Pass", latitude: 37.91044, longitude: -119.25778 },
      { slug: "tuolumne-meadows", name: "Tuolumne Meadows", latitude: 37.87522, longitude: -119.35666 },
      { slug: "vogelsang", name: "Vogelsang", latitude: 37.79514, longitude: -119.34532 },
      { slug: "white-wolf", name: "White Wolf", latitude: 37.86591, longitude: -119.64886 },
      { slug: "yosemite-creek-campground", name: "Yosemite Creek Campground", latitude: 37.83175, longitude: -119.58938 },
    ],
  },
];

// Flatten all points for polling.
export function getAllPoints(): (PointConfig & { areaSlug: string; areaName: string })[] {
  return areas.flatMap((area) =>
    area.points.map((p) => ({ ...p, areaSlug: area.slug, areaName: area.name }))
  );
}
