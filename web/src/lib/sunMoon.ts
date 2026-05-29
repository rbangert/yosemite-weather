import SunCalc from 'suncalc';

const LUNAR_CYCLE = 29.53058770576; // days

const MOON_ICONS: string[] = [
  'wi-moon-new',
  'wi-moon-waxing-crescent-1',
  'wi-moon-waxing-crescent-2',
  'wi-moon-waxing-crescent-3',
  'wi-moon-waxing-crescent-4',
  'wi-moon-waxing-crescent-5',
  'wi-moon-waxing-crescent-6',
  'wi-moon-first-quarter',
  'wi-moon-waxing-gibbous-1',
  'wi-moon-waxing-gibbous-2',
  'wi-moon-waxing-gibbous-3',
  'wi-moon-waxing-gibbous-4',
  'wi-moon-waxing-gibbous-5',
  'wi-moon-waxing-gibbous-6',
  'wi-moon-full',
  'wi-moon-waning-gibbous-1',
  'wi-moon-waning-gibbous-2',
  'wi-moon-waning-gibbous-3',
  'wi-moon-waning-gibbous-4',
  'wi-moon-waning-gibbous-5',
  'wi-moon-waning-gibbous-6',
  'wi-moon-third-quarter',
  'wi-moon-waning-crescent-1',
  'wi-moon-waning-crescent-2',
  'wi-moon-waning-crescent-3',
  'wi-moon-waning-crescent-4',
  'wi-moon-waning-crescent-5',
  'wi-moon-waning-crescent-6',
  // phase=1.0 wraps back to new — same as index 0, but we clamp below
];

const PHASE_NAMES = [
  { max: 0.033, name: 'New Moon' },
  { max: 0.233, name: 'Waxing Crescent' },
  { max: 0.283, name: 'First Quarter' },
  { max: 0.467, name: 'Waxing Gibbous' },
  { max: 0.533, name: 'Full Moon' },
  { max: 0.717, name: 'Waning Gibbous' },
  { max: 0.767, name: 'Third Quarter' },
  { max: 0.967, name: 'Waning Crescent' },
  { max: 1.001, name: 'New Moon' },
];

const MAJOR_PHASES = [
  { fraction: 0.0,  name: 'New Moon' },
  { fraction: 0.25, name: 'First Quarter' },
  { fraction: 0.5,  name: 'Full Moon' },
  { fraction: 0.75, name: 'Third Quarter' },
];

const pacificFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

export function formatPacific(date: Date): string {
  return pacificFmt.format(date);
}

export function formatDayLength(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m`;
}

export interface SunData {
  dawn: Date;
  sunrise: Date;
  solarNoon: Date;
  sunset: Date;
  dusk: Date;
  dayLengthMinutes: number;
}

export interface MoonData {
  moonrise: Date | null;
  moonset: Date | null;
  phase: number;
  illumination: number;
  phaseName: string;
  phaseIcon: string;
  nextPhaseName: string;
  daysToNextPhase: number;
}

export function getSunData(date: Date, lat: number, lon: number): SunData {
  const times = SunCalc.getTimes(date, lat, lon);
  const sunrise = times.sunrise;
  const sunset = times.sunsetStart;
  const dayLengthMinutes = (sunset.getTime() - sunrise.getTime()) / 60000;

  return {
    dawn: times.dawn,
    sunrise,
    solarNoon: times.solarNoon,
    sunset,
    dusk: times.dusk,
    dayLengthMinutes,
  };
}

export function getMoonData(date: Date, lat: number, lon: number): MoonData {
  const moonTimes = SunCalc.getMoonTimes(date, lat, lon);
  const illum = SunCalc.getMoonIllumination(date);
  const phase = illum.phase;

  const iconIndex = Math.min(Math.round(phase * 28), 28);
  const phaseIcon = MOON_ICONS[iconIndex];

  const phaseName = PHASE_NAMES.find(p => phase < p.max)?.name ?? 'New Moon';

  // Find the next major phase after the current one
  let nextPhase = MAJOR_PHASES.find(p => p.fraction > phase + 0.01);
  if (!nextPhase) nextPhase = MAJOR_PHASES[0]; // wraps to new moon

  const gap = nextPhase.fraction > phase
    ? nextPhase.fraction - phase
    : 1 - phase + nextPhase.fraction;
  const daysToNextPhase = Math.round(gap * LUNAR_CYCLE);

  return {
    moonrise: moonTimes.rise ?? null,
    moonset: moonTimes.set ?? null,
    phase,
    illumination: Math.round(illum.fraction * 100),
    phaseName,
    phaseIcon,
    nextPhaseName: nextPhase.name,
    daysToNextPhase,
  };
}
