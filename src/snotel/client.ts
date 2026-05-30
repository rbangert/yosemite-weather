// California CDEC (CA Dept of Water Resources) API client for SNOTEL SWE data.
// Sensor 3 = Snow Water Equivalent (SWE) in inches. No auth required.
const CDEC_BASE = "https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet";

export interface SnotelStation {
  stationId: string;
  name: string;
  elevationFt: number;
  latitude: number;
  longitude: number;
}

export interface SweReading {
  date: string;   // YYYY-MM-DD
  value: number | null; // inches, null = missing/trace
}

// Hardcoded Yosemite-area SNOTEL stations confirmed via NRCS AWDB metadata.
export const SNOTEL_STATIONS: SnotelStation[] = [
  { stationId: "TUM", name: "Tuolumne Meadows", elevationFt: 8600, latitude: 37.873,  longitude: -119.350 },
  { stationId: "DAN", name: "Dana Meadows",      elevationFt: 9810, latitude: 37.899,  longitude: -119.257 },
  { stationId: "TNY", name: "Tenaya Lake",        elevationFt: 8190, latitude: 37.830,  longitude: -119.463 },
  { stationId: "GIN", name: "Gin Flat",           elevationFt: 7050, latitude: 37.767,  longitude: -119.775 },
];

interface CdecRow {
  stationId: string;
  durCode: string;    // "D" = daily, "H" = hourly, "M" = monthly
  SENSOR_NUM: number;
  date: string;       // "YYYY-M-D HH:MM" (non-zero-padded)
  obsDate: string;
  value: number;      // numeric; -9999 = missing/not recorded
  dataFlag: string;
  units: string;
}

export async function fetchSweData(
  stationId: string,
  beginDate: string,  // YYYY-MM-DD
  endDate: string     // YYYY-MM-DD
): Promise<SweReading[]> {
  const url =
    `${CDEC_BASE}?Stations=${stationId}&SensorNums=3` +
    `&Start=${beginDate}&End=${endDate}&Dur=D`;

  const res = await fetch(url, {
    headers: { "User-Agent": "yosemite-weather/1.0 (weather monitoring app)" },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`CDEC ${stationId}: HTTP ${res.status}`);
  }

  const rows: CdecRow[] = await res.json();

  return rows
    .filter((row) => row.durCode === "D")  // daily readings only
    .map((row) => {
      // CDEC date format: "YYYY-M-D HH:MM" (non-zero-padded month/day)
      const rawDate = (row.date ?? row.obsDate ?? "").split(" ")[0];
      const [y, m, d] = rawDate.split("-");
      const date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
      // -9999 = missing/not recorded; negative values generally invalid for SWE
      const value = row.value != null && row.value > -999 ? row.value : null;
      return { date, value };
    })
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
}
