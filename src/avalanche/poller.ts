import { getDb } from "../db";
import { config, avalancheZones } from "../config";
import { fetchForecast, fetchZoneStatus } from "./client";

// Fetch the current avalanche forecast for every configured neighboring zone
// and upsert one snapshot row per zone. One zone failing (network, API hiccup)
// logs a warning but does not abort the others — same resilience as the SNOTEL
// poll loop.
export async function pollAvalanche(): Promise<void> {
  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO avalanche_forecasts (
      center_id, zone_id, zone_name, product_type, off_season, danger_level,
      published_time, expires_time, author, bottom_line, hazard_discussion,
      weather_discussion, danger_json, problems_json, link, fetched_at
    ) VALUES (
      $center_id, $zone_id, $zone_name, $product_type, $off_season, $danger_level,
      $published_time, $expires_time, $author, $bottom_line, $hazard_discussion,
      $weather_discussion, $danger_json, $problems_json, $link, $fetched_at
    )
    ON CONFLICT(center_id, zone_id) DO UPDATE SET
      zone_name = excluded.zone_name,
      product_type = excluded.product_type,
      off_season = excluded.off_season,
      danger_level = excluded.danger_level,
      published_time = excluded.published_time,
      expires_time = excluded.expires_time,
      author = excluded.author,
      bottom_line = excluded.bottom_line,
      hazard_discussion = excluded.hazard_discussion,
      weather_discussion = excluded.weather_discussion,
      danger_json = excluded.danger_json,
      problems_json = excluded.problems_json,
      link = excluded.link,
      fetched_at = excluded.fetched_at
  `);

  const now = new Date().toISOString();
  let stored = 0;

  for (const zone of avalancheZones) {
    try {
      const fc = await fetchForecast(zone.centerId, zone.zoneId, zone.name);

      // The product endpoint omits the outbound link + season window off-season;
      // backfill them from the map layer so the UI can still link out.
      let link = fc.link;
      if (!link) {
        try {
          const status = await fetchZoneStatus(zone.centerId, zone.zoneId);
          link = status?.link ?? null;
        } catch {
          /* status is best-effort */
        }
      }

      upsert.run({
        $center_id: zone.centerId,
        $zone_id: zone.zoneId,
        $zone_name: fc.zoneName,
        $product_type: fc.productType,
        $off_season: fc.offSeason ? 1 : 0,
        $danger_level: fc.dangerLevel,
        $published_time: fc.publishedTime,
        $expires_time: fc.expiresTime,
        $author: fc.author,
        $bottom_line: fc.bottomLine,
        $hazard_discussion: fc.hazardDiscussion,
        $weather_discussion: fc.weatherDiscussion,
        $danger_json: JSON.stringify(fc.danger),
        $problems_json: JSON.stringify(fc.problems),
        $link: link,
        $fetched_at: now,
      });
      stored++;
    } catch (err) {
      console.warn(`  Avalanche ${zone.centerId}/${zone.zoneId}: ${(err as Error).message}`);
    }
  }

  console.log(`Avalanche update: ${stored}/${avalancheZones.length} zones upserted at ${now}`);
}

// Exposed for parity with other pollers; the interval is configured in index.ts.
export const avalanchePollIntervalMs = config.avalanchePollIntervalMs;
