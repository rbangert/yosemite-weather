#!/usr/bin/env python3
"""
Render a visual summary of both wind-transport scripts into one PNG:
  (1) live current-conditions drift rose  (wind_transport_prototype -> real NWS stations)
  (2) ERA5 winter calibration            (wind_transport_calibrate -> VGNC1 location)
Themed with the project's Dracula palette.
"""
import importlib.util, math, statistics
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

# --- Dracula palette ---
BG="#282a36"; FG="#f8f8f2"; COMMENT="#6272a4"; CYAN="#8be9fd"; GREEN="#50fa7b"
ORANGE="#ffb86c"; PINK="#ff79c6"; PURPLE="#bd93f9"; RED="#ff5555"; YELLOW="#f1fa8c"
COMPASS16=["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]


def load(path, name):
    spec=importlib.util.spec_from_file_location(name, path); m=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m); return m

proto=load("scripts/wind_transport_prototype.py","proto")
cal=load("scripts/wind_transport_calibrate.py","cal")

plt.rcParams.update({"figure.facecolor":BG,"axes.facecolor":BG,"savefig.facecolor":BG,
    "text.color":FG,"axes.labelcolor":FG,"xtick.color":FG,"ytick.color":FG,
    "axes.edgecolor":COMMENT,"font.size":9})

fig=plt.figure(figsize=(20,12))
fig.suptitle("Yosemite High-Country Wind-Transported Snow Index", color=CYAN, fontsize=17, fontweight="bold", y=0.98)
fig.text(0.5,0.945,"VGNC1 Vogelsang 10,118 ft  |  STI = Σ max(0, U−U_t)³·Δt   (U_t=6 m/s)  |  free NWS + ERA5 data, no Synoptic",
         ha="center", color=COMMENT, fontsize=10)

def rose_ax(pos, rose, title, color):
    ax=fig.add_subplot(pos, projection="polar")
    ax.set_facecolor(BG); ax.set_theta_zero_location("N"); ax.set_theta_direction(-1)
    vals=[rose.get(c,0) for c in COMPASS16]; ang=np.deg2rad(np.arange(0,360,22.5))
    tot=sum(vals) or 1
    ax.bar(ang,[v/tot*100 for v in vals], width=np.deg2rad(20), color=color, edgecolor=BG, alpha=0.9)
    ax.set_xticks(np.deg2rad(np.arange(0,360,45)))
    ax.set_xticklabels(["N","NE","E","SE","S","SW","W","NW"], color=FG, fontsize=8)
    ax.set_yticklabels([]); ax.set_title(title, color=color, fontsize=11, pad=14)
    ax.grid(color=COMMENT, alpha=0.3)
    return ax

# ---------- Panel 1: ERA5 winter STI time series (ungated vs snow-gated) ----------
rows=cal.fetch_era5()
ts=[r["ts"] for r in rows]
# hourly transport contributions
ung=[]; gat=[]
for i,r in enumerate(rows):
    u=r["gst"] if r["gst"] is not None else r["spd"]
    w=cal.transport(u) if (u is not None and r["dir"] is not None) else 0.0
    ung.append(w)
    recent=sum(x["snow"] for x in rows[max(0,i-120):i+1]); cold=(r["tmp"] is not None and r["tmp"]<=0)
    gat.append(w if (recent>=1.0 and cold) else 0.0)
# rolling 24h sums
def roll(a,n=24):
    c=np.cumsum([0]+a); return [c[i+n]-c[i] for i in range(len(a)-n)]
ru, rg = roll(ung), roll(gat); tt=ts[:len(ru)]
ax1=fig.add_axes([0.07,0.57,0.55,0.32])
ax1.fill_between(tt,ru,color=RED,alpha=0.30,label="raw wind (ungated)")
ax1.fill_between(tt,rg,color=GREEN,alpha=0.65,label="snow-gated (actual loading)")
ax1.set_title("Winter 2025–26 rolling-24h Snow Transport Index  (ERA5, modeled)",color=FG,fontsize=11,loc="left")
ax1.set_ylabel("STI  (m/s)³·h"); ax1.legend(facecolor=BG,edgecolor=COMMENT,labelcolor=FG,loc="upper right",fontsize=8)
ax1.tick_params(axis="x",labelrotation=0); ax1.grid(color=COMMENT,alpha=0.2)
# annotate the dry-but-windy suppressed event
imax=int(np.argmax(ru))
ax1.annotate("high wind,\nno loose snow\n→ gate kills it",
    xy=(tt[imax],ru[imax]) if rg[imax]<ru[imax]*0.2 else (tt[int(np.argmax([u-g for u,g in zip(ru,rg)]))], max(ru)*0.6),
    color=YELLOW,fontsize=8,ha="center",
    arrowprops=dict(arrowstyle="->",color=YELLOW))

# ---------- Panel 2: STI distribution + percentile severity bins ----------
nz=[x for x in ru if x>0]
qs=statistics.quantiles(nz,n=100); p=lambda k:qs[k-1]
ax2=fig.add_axes([0.69,0.57,0.26,0.32])
ax2.hist(np.log10([x for x in nz if x>0]),bins=30,color=PURPLE,alpha=0.85)
for k,c,lab in [(50,CYAN,"p50"),(75,GREEN,"p75"),(95,ORANGE,"p95")]:
    ax2.axvline(math.log10(p(k)),color=c,ls="--",lw=1.5,label=f"{lab}={p(k):.0f}")
ax2.set_title("24h STI distribution → percentile severity",color=FG,fontsize=11,loc="left")
ax2.set_xlabel("log₁₀(STI)"); ax2.set_ylabel("windows")
ax2.legend(facecolor=BG,edgecolor=COMMENT,labelcolor=FG,fontsize=7.5)
ax2.grid(color=COMMENT,alpha=0.2)

# ---------- Panel 3: drift rose of the windiest winter storm ----------
step=6; best=(-1,None)
for i in range(0,len(rows)-24,step):
    m=cal.window_metrics(rows[i:i+24]);
    if m["sti"]>best[0]: best=(m["sti"],i)
si=best[1]; storm=cal.window_metrics(rows[max(0,si-12):si+36])
d=rows[si]["ts"]
rose_ax(234, storm["rose"], f"Windiest storm {d:%b %d}\nlee load → {COMPASS16[int((storm['rdd']%360)/22.5+0.5)%16]} ({storm['rdd']:.0f}°)", ORANGE)

# ---------- Panel 4: live current-conditions rose (real NWS data) ----------
try:
    live=proto.analyze(proto.fetch_obs("VGNC1",7),use_gust=True)
    title=f"LIVE VGNC1 last 7d\npeak gust {live['peak_gust']:.0f} mph"
    rose_ax(235, live["rose"], title, CYAN)
except Exception as e:
    ax=fig.add_subplot(235); ax.text(0.5,0.5,f"live fetch failed\n{e}",ha="center",color=RED); ax.axis("off")

# ---------- Panel 5: station roster / legend text ----------
ax5=fig.add_subplot(236); ax5.axis("off")
lines=[("Stations (all free via api.weather.gov):",FG),
       ("  VGNC1  Vogelsang    10,118 ft  gust ✓",GREEN),
       ("  WWRC1  White Wolf    8,038 ft  gust ~",GREEN),
       ("  TUMC1  Tuolumne Mdw  8,654 ft  no gust",COMMENT),
       ("  615SE/SE708 Tioga E  ~7,300 ft  gust ✓",GREEN),
       ("",FG),
       ("Snow-gate = cold + recent new snow.",YELLOW),
       ("47/480 high-wind windows suppressed",YELLOW),
       ("(strong wind over bare/old surface =",COMMENT),
       (" no avalanche loading).",COMMENT),
       ("",FG),
       ("Lee direction = downwind = loaded aspect.",PINK),
       ("SW storms → NE loading (Sierra norm);",PINK),
       ("E winds → W loading (reverse events).",PINK)]
for i,(t,c) in enumerate(lines):
    ax5.text(0.0,0.95-i*0.069,t,color=c,fontsize=9,family="monospace",transform=ax5.transAxes)

out="scripts/wind_transport_viz.png"
fig.savefig(out,dpi=200,bbox_inches="tight")
print("wrote",out)
