import { describe, expect, test } from "bun:test";
import { normalizeProduct } from "./client";
import activeForecast from "./fixtures/active-forecast.json";

// An off-season "summary" product: no danger array, no problems.
const summaryProduct = {
  product_type: "summary",
  published_time: "2026-04-19T14:00:00+00:00",
  expires_time: "2026-06-30T14:00:00+00:00",
  bottom_line: "<p>We have reached the end of the operating season.</p>",
  danger: [],
  forecast_avalanche_problems: [],
  forecast_zone: [{ id: 128, name: "Eastside Region", url: "https://example.org/z" }],
};

describe("normalizeProduct — active forecast", () => {
  const fc = normalizeProduct(activeForecast, "ESAC", 128, "Eastside Region");

  test("flags as in-season with a forecast product type", () => {
    expect(fc.productType).toBe("forecast");
    expect(fc.offSeason).toBe(false);
  });

  test("parses danger bands for current and tomorrow", () => {
    expect(fc.danger).toHaveLength(2);
    const current = fc.danger.find((d) => d.day === "current")!;
    expect(current).toEqual({ day: "current", upper: 3, middle: 2, lower: 1 });
  });

  test("overall danger is the worst current band", () => {
    expect(fc.dangerLevel).toBe(3); // Considerable, from upper band
  });

  test("parses avalanche problems with size range and locations", () => {
    expect(fc.problems).toHaveLength(2);
    const wind = fc.problems[0];
    expect(wind.name).toBe("Wind Slab");
    expect(wind.likelihood).toBe("likely");
    expect(wind.sizeMin).toBe("1");
    expect(wind.sizeMax).toBe("2");
    expect(wind.location).toContain("northeast upper");
  });

  test("carries discussion HTML and metadata", () => {
    expect(fc.bottomLine).toContain("Heightened avalanche conditions");
    expect(fc.author).toBe("J. Forecaster");
    expect(fc.link).toBe("https://www.esavalanche.org/forecasts#/eastside-region");
  });
});

describe("normalizeProduct — off-season summary", () => {
  const fc = normalizeProduct(summaryProduct, "ESAC", 128, "Eastside Region");

  test("flags as off-season with no rating", () => {
    expect(fc.offSeason).toBe(true);
    expect(fc.dangerLevel).toBe(-1);
    expect(fc.danger).toHaveLength(0);
    expect(fc.problems).toHaveLength(0);
  });

  test("still surfaces the bottom-line summary and link", () => {
    expect(fc.bottomLine).toContain("end of the operating season");
    expect(fc.link).toBe("https://example.org/z");
  });
});

describe("normalizeProduct — malformed input", () => {
  test("tolerates missing arrays and fields", () => {
    const fc = normalizeProduct({}, "BAC", 3004, "Bridgeport");
    expect(fc.offSeason).toBe(true);
    expect(fc.dangerLevel).toBe(-1);
    expect(fc.danger).toEqual([]);
    expect(fc.problems).toEqual([]);
    expect(fc.bottomLine).toBeNull();
  });
});
