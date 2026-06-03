#!/usr/bin/env python3
"""
Calibrate the Snow Transport Index against a real winter using ERA5 reanalysis
(Open-Meteo archive, free/no-key) at the VGNC1 (Vogelsang, 10,118 ft) location.

NOTE: ERA5 is MODELED wind on a coarse grid cell whose mean elevation is well below the
real summit -> absolute speeds run low and smooth. We use it to (a) exercise the full
pipeline on real storms, (b) demonstrate the snow-availability gate with ERA5 snowfall,
and (c) derive *relative* severity bins from winter climatology. Absolute thresholds for
the real stations need measured data (Synoptic) later.
"""
import json, urllib.request, urllib.parse, math, statistics
from datetime import datetime, timedelta

LAT, LON = 37.794, -119.347          # VGNC1 Vogelsang
START, END = "2025-12-01", "2026-03-31"
U_T = 6.0                            # transport threshold m/s
COMPASS16 = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]


def fetch_era5():
    q = urllib.parse.urlencode(dict(
        latitude=LAT, longitude=LON, start_date=START, end_date=END,
        hourly="wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,snowfall,snow_depth",
        wind_speed_unit="ms", timezone="UTC"))
    url = "https://archive-api.open-meteo.com/v1/archive?" + q
    d = json.load(urllib.request.urlopen(url, timeout=90))["hourly"]
    rows = []
    for i, t in enumerate(d["time"]):
        rows.append(dict(
            ts=datetime.fromisoformat(t),
            spd=d["wind_speed_10m"][i], gst=d["wind_gusts_10m"][i],
            dir=d["wind_direction_10m"][i], tmp=d["temperature_2m"][i],
            snow=d["snowfall"][i] or 0.0, depth=d["snow_depth"][i]))
    return rows


def compass(deg):
    return COMPASS16[int((deg % 360) / 22.5 + 0.5) % 16]


def transport(u):
    return max(0.0, (u or 0) - U_T) ** 3


def window_metrics(rows, gate=False):
    """STI + drift vector + rose over rows. If gate, zero out transport when no loose snow."""
    sti = 0.0; X = Y = 0.0; rose = {c: 0.0 for c in COMPASS16}
    # precompute 5-day trailing snowfall for the gate
    for i, r in enumerate(rows):
        u = r["gst"] if r["gst"] is not None else r["spd"]
        if u is None or r["dir"] is None:
            continue
        w = transport(u)  # dt = 1h (ERA5 is hourly)
        if gate:
            recent_snow = sum(x["snow"] for x in rows[max(0, i-120):i+1])  # ~5 days, cm
            cold = (r["tmp"] is not None and r["tmp"] <= 0)
            if recent_snow < 1.0 or not cold:   # <1cm loose snow OR warm -> no transport
                w = 0.0
        sti += w
        if w > 0:
            to = (r["dir"] + 180) % 360
            X += w * math.sin(math.radians(to)); Y += w * math.cos(math.radians(to))
            rose[compass(to)] += w
    rdp = math.hypot(X, Y)
    rdd = math.degrees(math.atan2(X, Y)) % 360 if rdp > 0 else None
    return dict(sti=sti, rdd=rdd, ratio=(rdp / sti if sti else 0), rose=rose)


def main():
    rows = fetch_era5()
    print(f"ERA5 @ VGNC1 ({LAT},{LON})  {START}..{END}   {len(rows)} hourly obs")
    pk = max((r["gst"] or 0) for r in rows)
    print(f"peak modeled gust: {pk:.1f} m/s ({pk*2.237:.0f} mph)   "
          f"max snow depth: {max((r['depth'] or 0) for r in rows):.2f} m\n")

    # rolling 24h STI stepped 6h -> winter climatology distribution (ungated)
    step = 6
    dist = []
    storms = []
    for i in range(0, len(rows) - 24, step):
        win = rows[i:i+24]
        m = window_metrics(win)
        dist.append(m["sti"])
        storms.append((m["sti"], win[0]["ts"], m))
    nz = [x for x in dist if x > 0]
    qs = statistics.quantiles(nz, n=100) if len(nz) > 4 else [0]*99
    p = lambda k: qs[k-1] if len(qs) >= k else 0
    print("24h STI winter climatology (ungated, modeled):")
    print(f"  nonzero windows: {len(nz)}/{len(dist)}   median={statistics.median(nz):.0f}  "
          f"p75={p(75):.0f}  p90={p(90):.0f}  p95={p(95):.0f}  max={max(dist):.0f}")
    print(f"\n  -> data-driven severity bins (relative, modeled scale):")
    print(f"       None/Trace < {p(50):.0f}   Light < {p(75):.0f}   "
          f"Moderate < {p(95):.0f}   Intense >= {p(95):.0f}\n")

    # top 5 distinct storms (dedupe overlapping windows by 2-day spacing)
    storms.sort(reverse=True)
    picked = []
    for sti, t0, m in storms:
        if all(abs((t0 - q[1]).total_seconds()) > 2*86400 for q in picked):
            picked.append((sti, t0, m))
        if len(picked) == 5:
            break
    print("Top 5 winter storms (24h STI):")
    print(f"  {'start':16} {'STI':>8}  {'lee/RDD':>9} {'focus':>6}")
    for sti, t0, m in picked:
        rdd = f"{compass(m['rdd'])}({m['rdd']:.0f})" if m['rdd'] is not None else "--"
        print(f"  {t0:%Y-%m-%d %H:%MZ} {sti:>8.0f}  {rdd:>9} {m['ratio']*100:>5.0f}%")

    # detail + GATE demo on the single windiest storm (widen to 48h around it)
    sti0, t0, _ = picked[0]
    s = next(i for i, r in enumerate(rows) if r["ts"] >= t0 - timedelta(hours=12))
    win = rows[s:s+48]
    ungated = window_metrics(win, gate=False)
    gated = window_metrics(win, gate=True)
    snowfall = sum(r["snow"] for r in win)
    print(f"\n=== windiest storm detail: {t0:%Y-%m-%d} (48h window) ===")
    print(f"  new snow in window: {snowfall:.1f} cm   "
          f"min temp: {min((r['tmp'] for r in win if r['tmp'] is not None)):.1f}C")
    print(f"  STI ungated = {ungated['sti']:.0f}   STI snow-gated = {gated['sti']:.0f}   "
          f"(gate {'KEPT' if gated['sti']>0 else 'SUPPRESSED'} transport)")
    rose = ungated["rose"]; mx = max(rose.values()) or 1; tot = sum(rose.values()) or 1
    print(f"  drift rose (lee loading aspect):")
    for c in COMPASS16:
        if rose[c] > 0:
            print(f"     {c:>3} {'#'*max(1,round(22*rose[c]/mx))} {rose[c]/tot*100:4.0f}%")
    rdd = ungated["rdd"]
    print(f"  resultant lee direction: {compass(rdd)} ({rdd:.0f}deg), focus {ungated['ratio']*100:.0f}%")
    print("\nReminder: modeled ERA5 -> use the SHAPE (timing/direction/relative bins & gate logic).")
    print("Absolute thresholds for VGNC1/WWRC1 need measured data (re-enable Synoptic) later.")


if __name__ == "__main__":
    main()
