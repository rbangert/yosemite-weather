#!/usr/bin/env python3
"""
Calibrate per-station severity thresholds from the MEASURED winter 2025-26 archive
cached by syn_archive.py. Replicates src/wind/transport.ts exactly (U_t=6 m/s, gust
preferred, dt clamped to 2h, cold gate) so the resulting (m/s)³·h thresholds drop
straight into classifySeverity.

Severity bins follow the same percentile scheme validated on ERA5:
  Light  < p50    Moderate < p75    Intense >= p95   (percentiles over NON-ZERO,
cold 24h windows — i.e. days when transport actually occurred on a cold surface).
"""
import os, json, math, statistics
from datetime import datetime, timedelta

CACHE_DIR = "data/wind_archive"
STATIONS = ["VGNC1", "WWRC1", "TUMC1", "615SE", "SE708"]
U_T = 6.0
COMPASS16 = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]


def load(stid):
    rows = json.load(open(os.path.join(CACHE_DIR, f"{stid}.json")))["obs"]
    out = []
    for r in rows:
        out.append((
            datetime.fromisoformat(r["t"].replace("Z", "+00:00")),
            r["spd"], r["gst"], r["dir"], r["tmp"],
        ))
    out.sort(key=lambda x: x[0])
    return out


def flux(u):
    return (u - U_T) ** 3 if (u is not None and u > U_T) else 0.0


def window_sti(rows, cold_gate=True):
    """STI over rows, replicating transport.ts. Returns (sti, vx, vy, rose)."""
    sti = 0.0; vx = 0.0; vy = 0.0
    rose = {c: 0.0 for c in COMPASS16}
    for i, (t, spd, gst, drc, tmp) in enumerate(rows):
        if spd is None or drc is None:
            continue
        dt = 1.0
        if i > 0:
            dt = min(2.0, max(0.0, (t - rows[i-1][0]).total_seconds() / 3600))
        eff = gst if gst is not None else spd
        w = flux(eff) * dt
        if w <= 0:
            continue
        cold = (tmp is None or tmp <= 0)
        if cold_gate and not cold:
            continue
        sti += w
        to = (drc + 180) % 360
        vx += w * math.sin(math.radians(to)); vy += w * math.cos(math.radians(to))
        rose[COMPASS16[round((to % 360) / 22.5) % 16]] += w
    return sti, vx, vy, rose


def pct(vals, p):
    if not vals:
        return 0
    s = sorted(vals); k = (len(s) - 1) * p / 100
    f = math.floor(k); c = min(f + 1, len(s) - 1)
    return s[f] + (s[c] - s[f]) * (k - f)


def main():
    print(f"Measured calibration — winter 2025-26  (U_t={U_T} m/s)\n")
    print(f"{'Station':8} {'obs':>6} {'cad':>5} {'pkGust':>7} {'nzWin':>6} "
          f"{'p50':>7} {'p75':>7} {'p95':>7} {'max':>8}   suggested bins (Light/Mod/Intense)")
    results = {}
    for stid in STATIONS:
        rows = load(stid)
        if len(rows) < 50:
            print(f"{stid:8} too few obs"); continue
        span_h = (rows[-1][0] - rows[0][0]).total_seconds() / 3600
        cad = round(span_h * 60 / len(rows))
        pk_gust = max([(g or s or 0) for _, s, g, _, _ in rows]) * 2.237

        # rolling 24h windows stepped 6h
        start = rows[0][0]; end = rows[-1][0]
        stis = []; storms = []
        t = start
        while t < end - timedelta(hours=24):
            win = [r for r in rows if t <= r[0] < t + timedelta(hours=24)]
            if len(win) >= 5:
                sti, vx, vy, rose = window_sti(win)
                stis.append(sti)
                if sti > 0:
                    rdp = math.hypot(vx, vy)
                    rdd = math.degrees(math.atan2(vx, vy)) % 360 if rdp > 0 else None
                    storms.append((sti, t, rdd, rose))
            t += timedelta(hours=6)

        nz = [x for x in stis if x > 0]
        p50, p75, p95, mx = pct(nz, 50), pct(nz, 75), pct(nz, 95), max(stis) if stis else 0
        results[stid] = dict(light=round(p50), moderate=round(p75), intense=round(p95))
        print(f"{stid:8} {len(rows):>6} {cad:>4}m {pk_gust:>6.0f} {len(nz):>6} "
              f"{p50:>7.0f} {p75:>7.0f} {p95:>7.0f} {mx:>8.0f}   "
              f"<{round(p50)} / <{round(p75)} / >={round(p95)}")

        # top 3 storms for the flagship
        if stid == "VGNC1":
            storms.sort(reverse=True)
            print("\n  VGNC1 top storms (measured):")
            for sti, t0, rdd, rose in storms[:4]:
                lee = COMPASS16[round((rdd % 360)/22.5) % 16] if rdd is not None else "--"
                print(f"    {t0:%Y-%m-%d}  STI={sti:8.0f}  lee={lee}({rdd:.0f}deg)")
            print()

    print("\nSuggested SEVERITY_THRESHOLDS for src/wind/stations.ts (m/s³·h, 24h gated):")
    print(json.dumps(results, indent=2))
    print("\nNote: single measured season -> provisional but REAL. Re-run with multi-year")
    print("archive once on a paid plan for sturdier percentiles. ERA5 ranked the same")
    print("storms; measured magnitudes are higher (real summit gusts vs coarse grid).")


if __name__ == "__main__":
    main()
