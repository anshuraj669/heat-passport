// The server works in °F (the OSHA/NWS thresholds are in °F) and says which unit the
// place uses. These helpers convert only for display, and convert typed °C back to °F.
export const toC = (f) => Math.round(((f - 32) * 5) / 9);
export const toF = (c) => Math.round((c * 9) / 5 + 32);

// 104 -> "104°F" or "40°C"
export const temp = (f, unit = 'F') => (f == null ? '—' : unit === 'C' ? `${toC(f)}°C` : `${Math.round(f)}°F`);
// Compact, for tight table headers: "40°"
export const deg = (f, unit = 'F') => (f == null ? '—' : `${unit === 'C' ? toC(f) : Math.round(f)}°`);
// A difference, e.g. "+15°F for full sun" -> "+8°C"
export const tempDelta = (d, unit = 'F') => (unit === 'C' ? `${Math.round((d * 5) / 9)}°C` : `${d}°F`);
