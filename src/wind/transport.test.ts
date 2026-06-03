import { describe, expect, test } from "bun:test";
import {
  transportFlux,
  degToCompass,
  classifySeverity,
  computeWindLoading,
  DEFAULT_THRESHOLD_MS,
  type WindObs,
} from "./transport";

describe("transportFlux", () => {
  test("is zero at or below threshold", () => {
    expect(transportFlux(0)).toBe(0);
    expect(transportFlux(DEFAULT_THRESHOLD_MS)).toBe(0);
    expect(transportFlux(DEFAULT_THRESHOLD_MS - 1)).toBe(0);
  });

  test("is the cube of the excess above threshold", () => {
    expect(transportFlux(DEFAULT_THRESHOLD_MS + 2)).toBe(8); // 2^3
    expect(transportFlux(16, 6)).toBe(1000); // 10^3
  });

  test("respects a custom threshold", () => {
    expect(transportFlux(10, 10)).toBe(0);
    expect(transportFlux(13, 10)).toBe(27);
  });
});

describe("degToCompass", () => {
  test("maps cardinal and intercardinal bearings", () => {
    expect(degToCompass(0)).toBe("N");
    expect(degToCompass(90)).toBe("E");
    expect(degToCompass(180)).toBe("S");
    expect(degToCompass(270)).toBe("W");
    expect(degToCompass(45)).toBe("NE");
  });

  test("wraps near 360 back to N and handles rounding", () => {
    expect(degToCompass(359)).toBe("N");
    expect(degToCompass(340)).toBe("NNW"); // 340/22.5 ≈ 15.1 → NNW
  });
});

describe("classifySeverity", () => {
  test("bands increase with STI using default bins", () => {
    // DEFAULT_SEVERITY = { light: 100, moderate: 1000, intense: 5000 }
    expect(classifySeverity(0)).toBe("None");
    expect(classifySeverity(50)).toBe("None");
    expect(classifySeverity(500)).toBe("Light");
    expect(classifySeverity(2_000)).toBe("Moderate");
    expect(classifySeverity(50_000)).toBe("Intense");
  });

  test("respects per-station thresholds", () => {
    const t = { light: 19, moderate: 82, intense: 645 }; // WWRC1 measured bins
    expect(classifySeverity(10, t)).toBe("None");
    expect(classifySeverity(50, t)).toBe("Light");
    expect(classifySeverity(300, t)).toBe("Moderate");
    expect(classifySeverity(700, t)).toBe("Intense");
  });
});

// Build N hourly obs with constant wind, starting at a fixed time.
function series(
  n: number,
  o: { speed?: number; gust?: number | null; dir?: number; temp?: number }
): WindObs[] {
  const start = Date.parse("2026-01-01T00:00:00Z");
  return Array.from({ length: n }, (_, i) => ({
    observedAt: new Date(start + i * 3_600_000).toISOString(),
    windSpeedMph: o.speed ?? 30,
    windGustMph: o.gust === undefined ? null : o.gust,
    windDirectionDeg: o.dir ?? 270, // wind FROM the west
    airTempF: o.temp ?? 20,
  }));
}

describe("computeWindLoading", () => {
  test("lee direction is downwind of the source (W wind loads E aspects)", () => {
    const r = computeWindLoading(series(24, { dir: 270 }), { snowAvailable: true });
    expect(r.leeDirection).toBe("E");
    expect(r.leeDirectionDeg).toBe(90);
    expect(r.stiGated).toBeGreaterThan(0);
    expect(r.gateOpen).toBe(true);
  });

  test("prefers gust over sustained speed", () => {
    const withGust = computeWindLoading(series(10, { speed: 20, gust: 40 }), { snowAvailable: true });
    const noGust = computeWindLoading(series(10, { speed: 20, gust: null }), { snowAvailable: true });
    expect(withGust.sti).toBeGreaterThan(noGust.sti);
    expect(withGust.peakGustMph).toBe(40);
  });

  test("snow-availability gate suppresses transport but keeps raw STI", () => {
    const obs = series(24, { dir: 270 });
    const open = computeWindLoading(obs, { snowAvailable: true });
    const shut = computeWindLoading(obs, { snowAvailable: false });
    expect(shut.sti).toBe(open.sti);       // raw index unaffected
    expect(shut.stiGated).toBe(0);          // gated index zeroed
    expect(shut.gateOpen).toBe(false);
    expect(shut.severity).toBe("None");
    expect(shut.leeDirection).toBeNull();
  });

  test("warm surface is gated out even when snow is available", () => {
    const warm = computeWindLoading(series(24, { temp: 50 }), { snowAvailable: true });
    expect(warm.stiGated).toBe(0);
    expect(warm.gateOpen).toBe(false);
  });

  test("calm winds below threshold produce no transport", () => {
    const calm = computeWindLoading(series(24, { speed: 5, gust: 8 }), { snowAvailable: true });
    expect(calm.sti).toBe(0);
    expect(calm.severity).toBe("None");
  });

  test("focus is ~1 for unidirectional, lower for variable winds", () => {
    const steady = computeWindLoading(series(24, { dir: 270 }), { snowAvailable: true });
    expect(steady.focus).toBeGreaterThan(0.95);

    // Alternating opposite directions should largely cancel the resultant.
    const start = Date.parse("2026-01-01T00:00:00Z");
    const mixed: WindObs[] = Array.from({ length: 24 }, (_, i) => ({
      observedAt: new Date(start + i * 3_600_000).toISOString(),
      windSpeedMph: 30,
      windGustMph: 40,
      windDirectionDeg: i % 2 === 0 ? 0 : 180,
      airTempF: 20,
    }));
    expect(computeWindLoading(mixed, { snowAvailable: true }).focus).toBeLessThan(0.2);
  });

  test("skips obs missing speed or direction", () => {
    const obs: WindObs[] = [
      { observedAt: "2026-01-01T00:00:00Z", windSpeedMph: null, windGustMph: null, windDirectionDeg: 270, airTempF: 20 },
      { observedAt: "2026-01-01T01:00:00Z", windSpeedMph: 30, windGustMph: 40, windDirectionDeg: null, airTempF: 20 },
    ];
    const r = computeWindLoading(obs, { snowAvailable: true });
    expect(r.sti).toBe(0);
    expect(r.obsCount).toBe(2);
  });
});
