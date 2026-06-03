// Helpers for rendering avalanche danger ratings and the aspect/elevation rose.
// Danger colors follow the official North American Avalanche Danger Scale
// (https://avalanche.org/avalanche-encyclopedia/danger-scale/). These are
// safety-critical, universally recognized colors and are intentionally NOT
// re-themed to the app palette.

export interface DangerLevelInfo {
  level: number;
  label: string;
  bg: string; // hex fill
  text: string; // legible text color on that fill
}

export const DANGER_SCALE: Record<number, DangerLevelInfo> = {
  [-1]: { level: -1, label: "No Rating", bg: "#3f4456", text: "#cbd5e1" },
  0: { level: 0, label: "No Rating", bg: "#3f4456", text: "#cbd5e1" },
  1: { level: 1, label: "Low", bg: "#53a653", text: "#0b1f0b" },
  2: { level: 2, label: "Moderate", bg: "#fff300", text: "#2a2a00" },
  3: { level: 3, label: "Considerable", bg: "#f79218", text: "#2a1700" },
  4: { level: 4, label: "High", bg: "#ef1c29", text: "#ffffff" },
  5: { level: 5, label: "Extreme", bg: "#1a1a1a", text: "#ef1c29" },
};

export function dangerInfo(level: number | null | undefined): DangerLevelInfo {
  const l = level == null ? -1 : level;
  return DANGER_SCALE[l] ?? DANGER_SCALE[-1];
}

// Has a published forecast expired? Off-season summaries set far-future or null
// expiries, so callers should also check `offSeason`.
export function isExpired(expiresTime: string | null | undefined): boolean {
  if (!expiresTime) return false;
  return new Date(expiresTime).getTime() < Date.now();
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

// --- Aspect / elevation rose geometry --------------------------------------

// 8 aspects clockwise from North (rendered at the top). Tokens in a problem's
// `location` array look like "north upper", "northeast middle", etc.
export const ASPECTS = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
] as const;

// Inner → outer rings. Lower elevation is the innermost ring.
export const ELEVATIONS = ["lower", "middle", "upper"] as const;

export type Aspect = (typeof ASPECTS)[number];
export type Elevation = (typeof ELEVATIONS)[number];

// Parse a location token ("north upper") into its aspect + elevation parts.
export function parseLocation(token: string): { aspect: string; elevation: string } {
  const t = token.trim().toLowerCase();
  for (const elev of ELEVATIONS) {
    if (t.endsWith(elev)) {
      return { aspect: t.slice(0, t.length - elev.length).trim(), elevation: elev };
    }
  }
  return { aspect: t, elevation: "" };
}

// Build the set of active "aspect|elevation" keys from a problem's locations,
// for O(1) lookup while drawing the rose.
export function activeSectors(locations: string[]): Set<string> {
  const set = new Set<string>();
  for (const loc of locations) {
    const { aspect, elevation } = parseLocation(loc);
    if (aspect && elevation) set.add(`${aspect}|${elevation}`);
  }
  return set;
}

// SVG path for one annular sector (a wedge of a ring). Angles in degrees with
// 0 = North (up); we offset so each aspect wedge is centered on its compass
// direction. cx/cy is the rose center.
export function sectorPath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startDeg: number,
  endDeg: number
): string {
  const toXY = (r: number, deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180; // -90 so 0° points up
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [x1, y1] = toXY(rOuter, startDeg);
  const [x2, y2] = toXY(rOuter, endDeg);
  const [x3, y3] = toXY(rInner, endDeg);
  const [x4, y4] = toXY(rInner, startDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${x1} ${y1}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}
