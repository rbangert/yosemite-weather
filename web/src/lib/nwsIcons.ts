// Maps NWS icon URL slugs to Erik Flowers weather-icons class names.
// NWS icon URLs follow the pattern:
//   https://api.weather.gov/icons/land/{day|night}/{slug1}[/{slug2}][,{pop}]?size=...
// The slug set is documented at https://www.weather.gov/forecast-icons

const DAY: Record<string, string> = {
  skc:              'wi-day-sunny',
  few:              'wi-day-sunny-overcast',
  sct:              'wi-day-cloudy',
  bkn:              'wi-day-cloudy',
  ovc:              'wi-cloudy',
  wind_skc:         'wi-day-cloudy-windy',
  wind_few:         'wi-day-cloudy-windy',
  wind_sct:         'wi-day-cloudy-windy',
  wind_bkn:         'wi-day-cloudy-windy',
  wind_ovc:         'wi-cloudy-windy',
  snow:             'wi-day-snow',
  rain_snow:        'wi-day-rain-mix',
  rain_sleet:       'wi-day-sleet',
  snow_sleet:       'wi-day-sleet',
  fzra:             'wi-day-rain-mix',
  rain_fzra:        'wi-day-rain-mix',
  snow_fzra:        'wi-day-rain-mix',
  sleet:            'wi-day-sleet',
  rain:             'wi-day-rain',
  rain_showers:     'wi-day-showers',
  rain_showers_hi:  'wi-day-sprinkle',
  tsra:             'wi-day-thunderstorm',
  tsra_sct:         'wi-day-storm-showers',
  tsra_hi:          'wi-day-storm-showers',
  blizzard:         'wi-day-snow-wind',
  fog:              'wi-day-fog',
  haze:             'wi-day-haze',
  smoke:            'wi-smoke',
  dust:             'wi-dust',
  hot:              'wi-hot',
  cold:             'wi-snowflake-cold',
  tornado:          'wi-tornado',
  hurricane:        'wi-hurricane',
  tropical_storm:   'wi-hurricane',
};

const NIGHT: Record<string, string> = {
  skc:              'wi-night-clear',
  few:              'wi-night-partly-cloudy',
  sct:              'wi-night-alt-cloudy',
  bkn:              'wi-night-alt-cloudy',
  ovc:              'wi-cloudy',
  wind_skc:         'wi-night-cloudy-windy',
  wind_few:         'wi-night-cloudy-windy',
  wind_sct:         'wi-night-cloudy-windy',
  wind_bkn:         'wi-night-cloudy-windy',
  wind_ovc:         'wi-cloudy-windy',
  snow:             'wi-night-alt-snow',
  rain_snow:        'wi-night-alt-rain-mix',
  rain_sleet:       'wi-night-alt-sleet',
  snow_sleet:       'wi-night-alt-sleet',
  fzra:             'wi-night-alt-rain-mix',
  rain_fzra:        'wi-night-alt-rain-mix',
  snow_fzra:        'wi-night-alt-rain-mix',
  sleet:            'wi-night-alt-sleet',
  rain:             'wi-night-alt-rain',
  rain_showers:     'wi-night-alt-showers',
  rain_showers_hi:  'wi-night-alt-sprinkle',
  tsra:             'wi-night-alt-thunderstorm',
  tsra_sct:         'wi-night-alt-storm-showers',
  tsra_hi:          'wi-night-alt-storm-showers',
  blizzard:         'wi-night-alt-snow-wind',
  fog:              'wi-night-fog',
  haze:             'wi-night-fog',
  smoke:            'wi-smoke',
  dust:             'wi-dust',
  hot:              'wi-hot',
  cold:             'wi-snowflake-cold',
  tornado:          'wi-tornado',
  hurricane:        'wi-hurricane',
  tropical_storm:   'wi-hurricane',
};

// Slugs that represent precipitation — used to prefer a secondary condition slug.
const PRECIP_SLUGS = new Set([
  'rain', 'rain_showers', 'rain_showers_hi', 'rain_snow', 'rain_sleet',
  'rain_fzra', 'snow', 'snow_sleet', 'snow_fzra', 'fzra', 'sleet',
  'tsra', 'tsra_sct', 'tsra_hi', 'blizzard',
]);

// Tailwind color class for a given slug + day/night context.
function iconColor(slug: string, isDay: boolean): string {
  if (['tsra', 'tsra_sct', 'tsra_hi'].includes(slug)) return 'text-amber-400';
  if (['tornado', 'hurricane', 'tropical_storm'].includes(slug))  return 'text-red-400';
  if (['rain', 'rain_showers', 'rain_showers_hi', 'rain_fzra', 'fzra'].includes(slug)) return 'text-blue-400';
  if (['snow', 'blizzard'].includes(slug)) return 'text-sky-200';
  if (['rain_snow', 'rain_sleet', 'snow_sleet', 'snow_fzra', 'sleet'].includes(slug)) return 'text-sky-300';
  if (['fog', 'haze', 'smoke', 'dust'].includes(slug)) return 'text-slate-400';
  if (slug === 'hot')  return 'text-orange-400';
  if (slug === 'cold') return 'text-sky-300';
  if (isDay) {
    if (['skc', 'few'].includes(slug))             return 'text-amber-400';
    if (['wind_skc', 'wind_few'].includes(slug))   return 'text-amber-300';
    return 'text-slate-300';
  }
  if (slug === 'skc') return 'text-indigo-300';
  return 'text-slate-500';
}

/**
 * Given a NWS icon URL and day/night flag, returns `{ wiClass, colorClass }`
 * where `wiClass` is the full `wi wi-*` class string and `colorClass` is a
 * Tailwind text-color class.
 *
 * Example input:
 *   "https://api.weather.gov/icons/land/day/bkn/tsra,40?size=medium", true
 * Example output:
 *   { wiClass: "wi wi-day-storm-showers", colorClass: "text-amber-400" }
 */
export function nwsIcon(
  iconUrl: string | null,
  isDay: boolean
): { wiClass: string; colorClass: string } {
  const fallback = isDay
    ? { wiClass: 'wi wi-day-sunny', colorClass: 'text-amber-400' }
    : { wiClass: 'wi wi-night-clear', colorClass: 'text-indigo-300' };

  if (!iconUrl) return fallback;

  // Extract slug portion after /day/ or /night/
  const match = iconUrl.match(/\/icons\/land\/(?:day|night)\/([^?]+)/);
  if (!match) return fallback;

  // Parse up to two condition slugs (strip trailing ",NN" precip probability)
  const parts = match[1].split('/').map(s => s.split(',')[0]);
  const primary   = parts[0];
  const secondary = parts[1];

  // Prefer secondary slug when it's a precip type (e.g. bkn/tsra → tsra)
  const slug = (secondary && PRECIP_SLUGS.has(secondary)) ? secondary : primary;

  const map = isDay ? DAY : NIGHT;
  const icon = map[slug] ?? (isDay ? 'wi-day-sunny' : 'wi-night-clear');

  return { wiClass: `wi ${icon}`, colorClass: iconColor(slug, isDay) };
}
