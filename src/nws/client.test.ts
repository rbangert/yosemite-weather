import { describe, expect, test, afterEach } from "bun:test";
import {
  durationHours,
  expandLayer,
  fetchGridpointForecast,
  fetchLatestObservation,
} from "./client";

describe("durationHours", () => {
  test("parses hour durations", () => {
    expect(durationHours("PT1H")).toBe(1);
    expect(durationHours("PT6H")).toBe(6);
  });

  test("parses days and combined day+hour", () => {
    expect(durationHours("P1D")).toBe(24);
    expect(durationHours("P1DT6H")).toBe(30);
  });

  test("parses weeks and minutes", () => {
    expect(durationHours("P1W")).toBe(168);
    expect(durationHours("PT30M")).toBe(0.5);
  });

  test("falls back to 1 for unparseable input", () => {
    expect(durationHours("garbage")).toBe(1);
  });
});

describe("expandLayer", () => {
  test("carries an instantaneous value across every hour of its interval", () => {
    const m = expandLayer({
      values: [{ validTime: "2026-01-01T00:00:00+00:00/PT3H", value: 5 }],
    });
    expect(m.size).toBe(3);
    expect(m.get("2026-01-01T00:00:00Z")).toBe(5);
    expect(m.get("2026-01-01T01:00:00Z")).toBe(5);
    expect(m.get("2026-01-01T02:00:00Z")).toBe(5);
  });

  test("divides an accumulation value evenly across the interval", () => {
    const m = expandLayer(
      { values: [{ validTime: "2026-01-01T00:00:00+00:00/PT4H", value: 8 }] },
      { accumulation: true }
    );
    expect(m.size).toBe(4);
    for (const v of m.values()) expect(v).toBe(2);
  });

  test("applies the conversion function", () => {
    const m = expandLayer(
      { values: [{ validTime: "2026-01-01T00:00:00+00:00/PT1H", value: 0 }] },
      { convert: (c) => (c * 9) / 5 + 32 }
    );
    expect(m.get("2026-01-01T00:00:00Z")).toBe(32);
  });

  test("converts after dividing accumulation", () => {
    // 50.8 mm over 2h -> 25.4 mm/h -> 1 inch/h
    const m = expandLayer(
      { values: [{ validTime: "2026-01-01T00:00:00+00:00/PT2H", value: 50.8 }] },
      { accumulation: true, convert: (mm) => mm / 25.4 }
    );
    expect(m.get("2026-01-01T00:00:00Z")).toBeCloseTo(1, 6);
    expect(m.get("2026-01-01T01:00:00Z")).toBeCloseTo(1, 6);
  });

  test("preserves nulls without converting", () => {
    const m = expandLayer(
      { values: [{ validTime: "2026-01-01T00:00:00+00:00/PT2H", value: null }] },
      { convert: () => 999 }
    );
    expect(m.get("2026-01-01T00:00:00Z")).toBeNull();
    expect(m.get("2026-01-01T01:00:00Z")).toBeNull();
  });

  test("returns empty map for missing layer or values", () => {
    expect(expandLayer(undefined).size).toBe(0);
    expect(expandLayer({}).size).toBe(0);
  });
});

// --- public functions with a stubbed fetch ---------------------------------

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(payload: unknown, ok = true) {
  globalThis.fetch = (async () =>
    ({ ok, status: ok ? 200 : 500, statusText: "", json: async () => payload }) as Response) as typeof fetch;
}

describe("fetchGridpointForecast", () => {
  // Anchor sample times to the current hour so they fall inside the horizon.
  const base = new Date();
  base.setUTCMinutes(0, 0, 0);
  const t0 = base.toISOString().replace(".000", "");
  const t1 = new Date(base.getTime() + 3_600_000).toISOString().replace(".000", "");

  test("assembles hourly rows with SI->English conversions", async () => {
    stubFetch({
      properties: {
        temperature: {
          uom: "wmoUnit:degC",
          values: [
            { validTime: `${t0}/PT1H`, value: 0 },
            { validTime: `${t1}/PT1H`, value: 100 },
          ],
        },
        windSpeed: {
          uom: "wmoUnit:km_h-1",
          values: [{ validTime: `${t0}/PT2H`, value: 100 }],
        },
        snowfallAmount: {
          uom: "wmoUnit:mm",
          values: [{ validTime: `${t0}/PT2H`, value: 50.8 }],
        },
        snowLevel: {
          uom: "wmoUnit:m",
          values: [{ validTime: `${t0}/PT1H`, value: 1000 }],
        },
        relativeHumidity: {
          uom: "wmoUnit:percent",
          values: [{ validTime: `${t0}/PT1H`, value: 80 }],
        },
      },
    });

    const hours = await fetchGridpointForecast("HNX", 1, 2, 240);
    expect(hours.length).toBe(2);

    const [h0, h1] = hours;
    expect(h0.airTemp).toBe(32); // 0°C
    expect(h1.airTemp).toBe(212); // 100°C
    expect(h0.windSpeed).toBeCloseTo(62.137, 2); // 100 km/h
    expect(h0.snowfallAmount).toBeCloseTo(1, 6); // 50.8mm / 2h / 25.4
    expect(h0.snowLevel).toBeCloseTo(3280.84, 2); // 1000 m
    expect(h0.relativeHumidity).toBe(80); // percent, unchanged
    expect(h1.snowLevel).toBeNull(); // layer only covered the first hour
  });

  test("drops forecast hours beyond the horizon", async () => {
    const far = new Date(base.getTime() + 100 * 3_600_000).toISOString().replace(".000", "");
    stubFetch({
      properties: {
        temperature: {
          uom: "wmoUnit:degC",
          values: [
            { validTime: `${t0}/PT1H`, value: 10 },
            { validTime: `${far}/PT1H`, value: 20 },
          ],
        },
      },
    });

    const hours = await fetchGridpointForecast("HNX", 1, 2, 24);
    expect(hours.length).toBe(1);
    expect(hours[0].airTemp).toBe(50); // 10°C
  });
});

describe("fetchLatestObservation", () => {
  test("converts measured values to English units", async () => {
    stubFetch({
      properties: {
        timestamp: "2026-05-28T23:00:00+00:00",
        temperature: { unitCode: "wmoUnit:degC", value: 0 },
        windSpeed: { unitCode: "wmoUnit:km_h-1", value: 100 },
        windGust: { value: null },
        windDirection: { value: 233 },
        relativeHumidity: { value: 87.8 },
        precipitationLastHour: null,
      },
    });

    const obs = await fetchLatestObservation("TUMC1");
    expect(obs).not.toBeNull();
    expect(obs!.observedAt).toBe("2026-05-28T23:00:00+00:00");
    expect(obs!.airTemp).toBe(32);
    expect(obs!.windSpeed).toBeCloseTo(62.137, 2);
    expect(obs!.windGust).toBeNull();
    expect(obs!.windDirection).toBe(233);
    expect(obs!.precipLastHour).toBeNull();
  });

  test("returns null when the station has no timestamp", async () => {
    stubFetch({ properties: {} });
    expect(await fetchLatestObservation("NONE")).toBeNull();
  });

  test("throws on a non-ok response", async () => {
    stubFetch({}, false);
    expect(fetchLatestObservation("BAD")).rejects.toThrow(/NWS API error/);
  });
});
