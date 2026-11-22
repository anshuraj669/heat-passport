// Where a worker is: place search, GPS-to-place lookup, and local emergency numbers.
// City search: Open-Meteo geocoding (worldwide, free, no key).
// GPS -> place: OpenStreetMap Nominatim (worldwide, free, max 1 request/second, needs a User-Agent).

const UA = 'HeatPassport/0.3 (prototype)';
const CACHE_MS = 24 * 3_600_000;
const reverseCache = new Map();

// Ambulance first: heat stroke needs an ambulance. `primary` is the number the SOS button dials.
// Prototype data: verify every number with local authorities before real-world use.
const E = (primary, services) => ({ primary, services });
const EU_112 = E('112', [{ service: 'all', number: '112' }]);
const NUMBERS = {
  // Americas
  US: E('911', [{ service: 'all', number: '911' }]),
  CA: E('911', [{ service: 'all', number: '911' }]),
  MX: E('911', [{ service: 'all', number: '911' }]),
  BR: E('192', [{ service: 'ambulance', number: '192' }, { service: 'police', number: '190' }, { service: 'fire', number: '193' }]),
  AR: E('107', [{ service: 'ambulance', number: '107' }, { service: 'police', number: '911' }, { service: 'fire', number: '100' }]),
  CO: E('123', [{ service: 'all', number: '123' }]),
  CL: E('131', [{ service: 'ambulance', number: '131' }, { service: 'police', number: '133' }, { service: 'fire', number: '132' }]),
  PE: E('106', [{ service: 'ambulance', number: '106' }, { service: 'police', number: '105' }, { service: 'fire', number: '116' }]),
  // South Asia
  IN: E('108', [{ service: 'ambulance', number: '108' }, { service: 'all', number: '112' }, { service: 'police', number: '100' }, { service: 'fire', number: '101' }]),
  PK: E('1122', [{ service: 'ambulance', number: '1122' }, { service: 'police', number: '15' }, { service: 'fire', number: '16' }]),
  BD: E('999', [{ service: 'all', number: '999' }]),
  NP: E('102', [{ service: 'ambulance', number: '102' }, { service: 'police', number: '100' }, { service: 'fire', number: '101' }]),
  LK: E('1990', [{ service: 'ambulance', number: '1990' }, { service: 'police', number: '119' }, { service: 'fire', number: '110' }]),
  // Gulf and Middle East
  AE: E('998', [{ service: 'ambulance', number: '998' }, { service: 'police', number: '999' }, { service: 'fire', number: '997' }]),
  SA: E('997', [{ service: 'ambulance', number: '997' }, { service: 'police', number: '999' }, { service: 'fire', number: '998' }, { service: 'all', number: '911' }]),
  QA: E('999', [{ service: 'all', number: '999' }]),
  KW: E('112', [{ service: 'all', number: '112' }]),
  BH: E('999', [{ service: 'all', number: '999' }]),
  OM: E('9999', [{ service: 'all', number: '9999' }]),
  JO: E('911', [{ service: 'all', number: '911' }]),
  EG: E('123', [{ service: 'ambulance', number: '123' }, { service: 'police', number: '122' }, { service: 'fire', number: '180' }]),
  // Europe
  GB: E('999', [{ service: 'all', number: '999' }, { service: 'all', number: '112' }]),
  IE: E('112', [{ service: 'all', number: '112' }, { service: 'all', number: '999' }]),
  ...Object.fromEntries(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'NO', 'CH', 'IS', 'TR'].map((c) => [c, EU_112])),
  // Africa
  NG: E('112', [{ service: 'all', number: '112' }]),
  KE: E('999', [{ service: 'all', number: '999' }, { service: 'all', number: '112' }]),
  GH: E('112', [{ service: 'all', number: '112' }]),
  ZA: E('10177', [{ service: 'ambulance', number: '10177' }, { service: 'police', number: '10111' }, { service: 'all', number: '112' }]),
  // East and Southeast Asia, Oceania
  CN: E('120', [{ service: 'ambulance', number: '120' }, { service: 'police', number: '110' }, { service: 'fire', number: '119' }]),
  JP: E('119', [{ service: 'ambulance', number: '119' }, { service: 'police', number: '110' }]),
  KR: E('119', [{ service: 'ambulance', number: '119' }, { service: 'police', number: '112' }]),
  SG: E('995', [{ service: 'ambulance', number: '995' }, { service: 'police', number: '999' }]),
  MY: E('999', [{ service: 'all', number: '999' }]),
  ID: E('112', [{ service: 'all', number: '112' }, { service: 'ambulance', number: '118' }]),
  TH: E('1669', [{ service: 'ambulance', number: '1669' }, { service: 'police', number: '191' }, { service: 'fire', number: '199' }]),
  VN: E('115', [{ service: 'ambulance', number: '115' }, { service: 'police', number: '113' }, { service: 'fire', number: '114' }]),
  PH: E('911', [{ service: 'all', number: '911' }]),
  AU: E('000', [{ service: 'all', number: '000' }, { service: 'all', number: '112' }]),
  NZ: E('111', [{ service: 'all', number: '111' }]),
};

// 112 reaches emergency services from most mobile phones worldwide, so it is the fallback.
const FALLBACK = { ...E('112', [{ service: 'all', number: '112' }]), unknown: true };

export function emergencyNumbers(countryCode) {
  const code = String(countryCode ?? '').toUpperCase();
  const known = NUMBERS[code];
  return known ? { countryCode: code, ...known, unknown: false } : { countryCode: code || null, ...FALLBACK };
}

export function validCoords(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  return lat != null && lon != null && lat !== '' && lon !== '' && Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180
    ? { lat: Math.round(la * 1e4) / 1e4, lon: Math.round(lo * 1e4) / 1e4 }
    : null;
}

const placeName = (...parts) => [...new Set(parts.filter(Boolean))].join(', ');

// "Delhi" -> up to 5 matching places worldwide.
export async function searchPlaces(query) {
  const q = String(query ?? '').trim().slice(0, 100);
  if (q.length < 2) return [];
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name: q, count: '5', language: 'en', format: 'json' });
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Place search failed (${res.status})`);
  const { results = [] } = await res.json();
  return results.map((r) => ({
    lat: r.latitude, lon: r.longitude,
    name: placeName(r.name, r.admin1, r.country),
    country: r.country ?? null, countryCode: r.country_code?.toUpperCase() ?? null,
    timezone: r.timezone ?? null,
  }));
}

// GPS coordinates -> place name and country. Never throws: a failed lookup still keeps the coordinates.
export async function reversePlace(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`; // ~1 km, also keeps the exact position out of the cache key
  const hit = reverseCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit.place, lat, lon };
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.search = new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lon), zoom: '10', 'accept-language': 'en' });
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const { address = {} } = await res.json();
    const place = {
      name: placeName(address.city ?? address.town ?? address.village ?? address.county, address.state, address.country) || null,
      country: address.country ?? null,
      countryCode: address.country_code?.toUpperCase() ?? null,
    };
    reverseCache.set(key, { at: Date.now(), place });
    return { ...place, lat, lon };
  } catch {
    return { lat, lon, name: null, country: null, countryCode: null };
  }
}

// Build the stored location from what the app sent. A place picked from search already has
// its country; a GPS fix is looked up.
export async function resolveLocation(input) {
  const coords = validCoords(input?.lat, input?.lon);
  if (!coords) return null;
  const source = input.source === 'search' ? 'search' : 'gps';
  const place = source === 'search' && input.countryCode
    ? { ...coords, name: String(input.name ?? '').slice(0, 120) || null, country: input.country ?? null, countryCode: String(input.countryCode).toUpperCase().slice(0, 2) }
    : await reversePlace(coords.lat, coords.lon);
  return {
    ...place,
    name: place.name ?? `${coords.lat.toFixed(2)}, ${coords.lon.toFixed(2)}`,
    source,
    updatedAt: new Date().toISOString(),
  };
}
