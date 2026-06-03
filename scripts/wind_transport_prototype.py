#!/usr/bin/env python3
"""
Prototype: wind-transported-snow / loading index for Yosemite high country.

Pulls recent observations from in-park high-elevation NWS stations and computes:
  - Snow Transport Index (STI): sum of max(0, U - U_t)^3 * dt  (transport is ~cubic above threshold)
  - Fryberger-style drift vector: Resultant Drift Direction (RDD = downwind = lee loading) + RDP/DP ratio
  - A 16-point drift rose
  - A simple cold-enough gate (full version would also gate on SNOTEL new-snow availability)

This is throwaway analysis to show output shape before wiring anything into the poller.
"""
import json, urllib.request, math, sys
from datetime import datetime, timezone, timedelta

UA = "yosemite-weather-prototype (rbangert@proton.me)"
KMH_TO_MS = 1000 / 3600
MS_TO_MPH = 2.23694
U_T_MS = 6.0  # transport threshold for fresh cold snow (~13.4 mph). Configurable.

# In-park high stations (id, label, elevation ft). VGNC1 is the alpine flagship.
STATIONS = [
    ("VGNC1", "Vogelsang", 10118),
    ("WWRC1", "White Wolf", 8038),
    ("TUMC1", "Tuolumne Mdws", 8654),
]
COMPASS16 = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/geo+json"})
    return json.load(urllib.request.urlopen(req, timeout=30))


def fetch_obs(stid, days=7):
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    url = (f"https://api.weather.gov/stations/{stid}/observations"
           f"?start={start:%Y-%m-%dT%H:%M:%SZ}&end={end:%Y-%m-%dT%H:%M:%SZ}&limit=500")
    feats = get(url)["features"]
    rows = []
    for f in feats:
        p = f["properties"]
        ts = datetime.fromisoformat(p["timestamp"])
        spd = p["windSpeed"]["value"]      # km/h
        gst = p["windGust"]["value"]       # km/h or None
        drc = p["windDirection"]["value"]  # deg FROM, or None
        tmp = p["temperature"]["value"]    # degC or None
        rows.append((ts, spd, gst, drc, tmp))
    rows.sort(key=lambda r: r[0])
    return rows


def compass(deg):
    return COMPASS16[int((deg % 360) / 22.5 + 0.5) % 16]


def analyze(rows, use_gust=False):
    """Return STI, drift vector, rose, gate stats over the provided rows."""
    sti = 0.0
    X = Y = 0.0  # drift vector components (toward downwind)
    rose = {c: 0.0 for c in COMPASS16}
    cold_n = total_n = 0
    peak_gust_mph = 0.0
    peak_sust_mph = 0.0
    for i, (ts, spd, gst, drc, tmp) in enumerate(rows):
        if spd is None or drc is None:
            continue
        # dt = gap to previous obs, clamped to avoid huge gaps dominating
        dt_h = 1.0
        if i > 0:
            dt_h = min(2.0, max(0.0, (ts - rows[i-1][0]).total_seconds() / 3600))
        u_ms = (gst if (use_gust and gst is not None) else spd) * KMH_TO_MS
        peak_sust_mph = max(peak_sust_mph, spd * KMH_TO_MS * MS_TO_MPH)
        if gst is not None:
            peak_gust_mph = max(peak_gust_mph, gst * KMH_TO_MS * MS_TO_MPH)
        excess = max(0.0, u_ms - U_T_MS)
        w = (excess ** 3) * dt_h
        sti += w
        if w > 0:
            to = (drc + 180) % 360  # downwind = lee loading direction
            X += w * math.sin(math.radians(to))
            Y += w * math.cos(math.radians(to))
            rose[compass(to)] += w
        total_n += 1
        if tmp is not None and tmp <= 0:
            cold_n += 1
    dp = sti
    rdp = math.hypot(X, Y)
    rdd = math.degrees(math.atan2(X, Y)) % 360 if rdp > 0 else None
    ratio = (rdp / dp) if dp > 0 else 0
    cold_frac = (cold_n / total_n) if total_n else 0
    return dict(sti=sti, rdd=rdd, ratio=ratio, rose=rose,
                cold_frac=cold_frac, peak_gust=peak_gust_mph, peak_sust=peak_sust_mph)


def windiest_24h(rows):
    """Slide a 24h window, return (start, end, sti) for the window with max STI."""
    best = (None, None, -1)
    for i in range(len(rows)):
        t0 = rows[i][0]
        window = [r for r in rows if t0 <= r[0] < t0 + timedelta(hours=24)]
        s = analyze(window, use_gust=True)["sti"]
        if s > best[2]:
            best = (t0, t0 + timedelta(hours=24), s)
    return best


def severity(sti):
    # Relative, prototype thresholds (units: (m/s)^3 * h). Tune against known events.
    if sti < 50: return "None/Trace"
    if sti < 500: return "Light"
    if sti < 3000: return "Moderate"
    return "Intense"


def rose_bars(rose, width=24):
    mx = max(rose.values()) or 1
    out = []
    for c in COMPASS16:
        v = rose[c]
        if v <= 0: continue
        bar = "#" * max(1, round(width * v / mx))
        out.append(f"   {c:>3} {bar} {v/sum(rose.values())*100:4.0f}%")
    return "\n".join(out)


def main():
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    print(f"Snow Transport Index over last {days} days  (U_t = {U_T_MS} m/s = {U_T_MS*MS_TO_MPH:.0f} mph)\n")
    print(f"{'Station':14} {'elev':>6}  {'sust':>5} {'gust':>5}  {'STI':>9}  {'severity':10} {'RDD(lee)':>9} {'focus':>6} {'cold':>5}")
    for stid, label, elev in STATIONS:
        try:
            rows = fetch_obs(stid, days)
        except Exception as e:
            print(f"{label:14} ERROR {e}"); continue
        a = analyze(rows, use_gust=True)
        rdd = f"{compass(a['rdd'])}({a['rdd']:.0f})" if a['rdd'] is not None else "--"
        print(f"{label:14} {elev:>5}'  {a['peak_sust']:>4.0f} {a['peak_gust']:>4.0f}  "
              f"{a['sti']:>9.0f}  {severity(a['sti']):10} {rdd:>9} {a['ratio']*100:>5.0f}% {a['cold_frac']*100:>4.0f}%")
        # detail for the flagship
        if stid == "VGNC1":
            w0, w1, ws = windiest_24h(rows)
            print(f"\n  -- {label} ({elev}') drift rose (where snow is loading / lee aspect) --")
            print(rose_bars(a["rose"]))
            if w0:
                print(f"  Windiest 24h: {w0:%m-%d %H:%M}-{w1:%H:%M}Z  STI={ws:.0f} ({severity(ws)})")
            print(f"  (peak gust {a['peak_gust']:.0f} mph, transport focus {a['ratio']*100:.0f}% "
                  f"-> {'unidirectional' if a['ratio']>0.6 else 'variable'} loading)\n")
    print("Notes: STI units (m/s)^3*h, relative. 'focus' = RDP/DP (100% = single aspect).")
    print("       'cold' = % obs <=0C (proxy). Full gate also needs SNOTEL new-snow availability.")
    print("       Point masts -> relative severity + directional hint, not absolute flux.")


if __name__ == "__main__":
    main()
