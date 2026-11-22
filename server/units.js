// Temperatures are stored and computed in °F, because the OSHA/NWS thresholds are defined
// in °F. Only what people see is converted, by the country of the place being shown.

// Places that use Fahrenheit day to day. Everywhere else (and an unknown country) uses Celsius.
const FAHRENHEIT = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM', 'LR', 'BS', 'BZ', 'KY', 'PW', 'MH', 'FM']);

export const unitFor = (countryCode) => (FAHRENHEIT.has(String(countryCode ?? '').toUpperCase()) ? 'F' : 'C');

export const toC = (f) => Math.round(((f - 32) * 5) / 9);

// 104 -> "104°F" or "40°C"
export const formatTemp = (f, unit = 'F') => (f == null ? '—' : unit === 'C' ? `${toC(f)}°C` : `${Math.round(f)}°F`);
