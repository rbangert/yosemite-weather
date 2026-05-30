import { getDb } from "../db";
import { config } from "../config";
import { fetchSweData, SNOTEL_STATIONS } from "./client";

// Returns the water year that contains a given date.
// WY2026 = Oct 1 2025 – Sep 30 2026.
function waterYear(date: Date): number {
  return date.getMonth() >= 9 ? date.getFullYear() + 1 : date.getFullYear();
}

function wyStart(wy: number): string {
  return `${wy - 1}-10-01`;
}

function wyEnd(wy: number): string {
  return `${wy}-09-30`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Fetch + upsert SWE readings for one station over a date range.
async function fetchAndStore(stationId: string, begin: string, end: string): Promise<number> {
  const db = getDb();
  const rows = await fetchSweData(stationId, begin, end);

  const upsert = db.prepare(`
    INSERT INTO swe_readings (station_id, date, value_in)
    VALUES (?, ?, ?)
    ON CONFLICT(station_id, date) DO UPDATE SET value_in = excluded.value_in
  `);

  const tx = db.transaction(() => {
    for (const row of rows) {
      upsert.run(stationId, row.date, row.value);
    }
  });
  tx();
  return rows.length;
}

// Backfill all water years if the table is sparse (first run or after DB reset).
export async function backfillSwe(): Promise<void> {
  const db = getDb();
  const { count } = db.prepare(`SELECT COUNT(*) AS count FROM swe_readings`).get() as { count: number };

  // Each station × each year has at most ~365 rows. If we already have a
  // reasonable fraction, assume backfill was done.
  const threshold = SNOTEL_STATIONS.length * config.snotelBackfillYears * 100;
  if (count >= threshold) return;

  const currentWy = waterYear(new Date());
  const firstWy = currentWy - config.snotelBackfillYears + 1;

  console.log(`SNOTEL backfill: WY${firstWy}–WY${currentWy} for ${SNOTEL_STATIONS.length} stations...`);

  for (const station of SNOTEL_STATIONS) {
    let total = 0;
    for (let wy = firstWy; wy <= currentWy; wy++) {
      const begin = wyStart(wy);
      const end = wy === currentWy ? today() : wyEnd(wy);
      try {
        const n = await fetchAndStore(station.stationId, begin, end);
        total += n;
      } catch (err) {
        console.warn(`  SNOTEL ${station.stationId} WY${wy}: ${(err as Error).message}`);
      }
    }
    console.log(`  ${station.stationId} (${station.name}): ${total} readings stored`);
  }
}

// Update just the current water year for each station (daily refresh).
export async function updateSwe(): Promise<void> {
  const wy = waterYear(new Date());
  const begin = wyStart(wy);
  const end = today();

  let total = 0;
  for (const station of SNOTEL_STATIONS) {
    try {
      const n = await fetchAndStore(station.stationId, begin, end);
      total += n;
    } catch (err) {
      console.warn(`  SNOTEL update ${station.stationId}: ${(err as Error).message}`);
    }
  }
  console.log(`SNOTEL update: ${total} readings upserted at ${new Date().toISOString()}`);
}

export async function pollSnotel(): Promise<void> {
  await backfillSwe();
  await updateSwe();
}
