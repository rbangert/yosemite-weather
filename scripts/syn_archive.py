#!/usr/bin/env python3
"""
One-time: pull MEASURED winter wind archives from Synoptic for the high-elevation
stations and cache them to data/wind_archive/{stid}.json so calibration survives
the trial token expiring. Reads the token from .env (never hard-coded).

Usage:
  python scripts/syn_archive.py                # winter 2025-26, all 5 stations
  python scripts/syn_archive.py VGNC1 2015 2026 # one station, multi-year backfill
"""
import re, os, sys, json, time, urllib.request, urllib.parse, urllib.error

STATIONS = ["VGNC1", "WWRC1", "TUMC1", "615SE", "SE708"]
CACHE_DIR = "data/wind_archive"


def token():
    for line in open(".env", encoding="utf-8"):
        s = line.strip()
        if s.startswith("#"):
            continue
        m = re.match(r"SYNOPTIC_API_TOKEN=([0-9a-fA-F]{16,})", s)
        if m:
            return m.group(1)
    raise SystemExit("no active SYNOPTIC_API_TOKEN in .env")


def fetch(stid, start, end, tok):
    q = urllib.parse.urlencode(dict(
        stid=stid, start=start, end=end, token=tok,
        vars="wind_speed,wind_gust,wind_direction,air_temp",
        units="metric", obtimezone="utc"))
    url = "https://api.synopticdata.com/v2/stations/timeseries?" + q
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.load(r)


def winters(start_year, end_year):
    """Yield (start, end) Synoptic timestamps for each Dec1–May1 winter window."""
    for y in range(start_year, end_year):
        yield (f"{y}12010000", f"{y+1}05010000")


def pull(stid, start_year, end_year, tok):
    os.makedirs(CACHE_DIR, exist_ok=True)
    merged = {}  # observed_at -> dict
    total_su = 0
    for start, end in winters(start_year, end_year):
        try:
            d = fetch(stid, start, end, tok)
        except urllib.error.HTTPError as e:
            print(f"  {stid} {start[:6]}: HTTP {e.code} {e.read()[:120]}")
            continue
        summ = d.get("SUMMARY", {})
        stns = d.get("STATION", [])
        if not stns:
            print(f"  {stid} {start[:6]}–{end[:6]}: no data ({summ.get('RESPONSE_MESSAGE')})")
            continue
        O = stns[0]["OBSERVATIONS"]
        times = O.get("date_time", [])
        spd = O.get("wind_speed_set_1", [None] * len(times))
        gst = O.get("wind_gust_set_1", [None] * len(times))
        drc = O.get("wind_direction_set_1", [None] * len(times))
        tmp = O.get("air_temp_set_1", [None] * len(times))
        for i, t in enumerate(times):
            merged[t] = {"t": t, "spd": spd[i], "gst": gst[i], "dir": drc[i], "tmp": tmp[i]}
        print(f"  {stid} {start[:6]}–{end[:6]}: {len(times)} obs")
        time.sleep(0.4)
    rows = [merged[k] for k in sorted(merged)]
    path = os.path.join(CACHE_DIR, f"{stid}.json")
    json.dump({"stid": stid, "units": "m/s,degC,deg", "obs": rows}, open(path, "w"))
    print(f"  -> cached {len(rows)} obs to {path}")
    return len(rows)


def main():
    tok = token()
    if len(sys.argv) == 4:
        stid, sy, ey = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
        pull(stid, sy, ey, tok)
        return
    # default: winter 2025-26 for all stations
    for stid in STATIONS:
        print(f"{stid}:")
        pull(stid, 2025, 2026, tok)


if __name__ == "__main__":
    main()
