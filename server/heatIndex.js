// NWS heat index: Rothfusz regression with the NWS low/high humidity adjustments.
// https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml
export function heatIndex(tempF, rh) {
  const simple = 0.5 * (tempF + 61 + (tempF - 68) * 1.2 + rh * 0.094);
  if ((simple + tempF) / 2 < 80) return Math.round(simple);

  const t = tempF;
  let hi =
    -42.379 + 2.04901523 * t + 10.14333127 * rh - 0.22475541 * t * rh -
    0.00683783 * t * t - 0.05481717 * rh * rh + 0.00122874 * t * t * rh +
    0.00085282 * t * rh * rh - 0.00000199 * t * t * rh * rh;

  if (rh < 13 && t >= 80 && t <= 112) {
    hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
  } else if (rh > 85 && t >= 80 && t <= 87) {
    hi += ((rh - 85) / 10) * ((87 - t) / 5);
  }
  return Math.round(hi);
}

// Risk bands and protective measures from the OSHA-NIOSH Heat Safety Tool.
const LEVELS = [
  {
    max: 91, level: 'lower', label: 'Lower (Caution)',
    actions: ['Provide drinking water, rest and shade', 'Remind workers of heat illness signs'],
  },
  {
    max: 103, level: 'moderate', label: 'Moderate',
    actions: ['Drink about 1 cup of water every 15–20 minutes', 'Schedule frequent breaks in shade', 'Watch new and returning workers closely'],
  },
  {
    max: 115, level: 'high', label: 'High',
    actions: ['Move strenuous work to cooler hours', 'Use a buddy system and check workers often', 'Rest breaks in shade every hour'],
  },
  {
    max: Infinity, level: 'extreme', label: 'Very High to Extreme',
    actions: ['Reschedule non-essential outdoor work', 'If work must happen: very frequent breaks and constant monitoring', 'Have a medical emergency plan ready'],
  },
];

export function riskLevel(hi) {
  if (hi == null) return null;
  const { max, ...rest } = LEVELS.find((l) => hi < l.max);
  return rest;
}
