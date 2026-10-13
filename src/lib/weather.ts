import type { Weather } from "./model";

/** Used when geolocation is unavailable or declined. */
export const LONDON = { lat: 51.5072, lon: -0.1276, place: "London" };

interface OpenMeteoHourly {
  hourly?: { time: string[]; surface_pressure: (number | null)[]; temperature_2m: (number | null)[] };
  utc_offset_seconds?: number;
}

/**
 * Pressure now, its 24 h change and temperature from Open-Meteo (free, no key).
 * Uses the hourly series with one past day so ΔP₂₄ = P(now) − P(now − 24 h).
 */
export function parseOpenMeteo(data: OpenMeteoHourly, now: Date, place: string, source: Weather["source"]): Weather | null {
  const h = data.hourly;
  if (!h?.time?.length) return null;
  const offset = (data.utc_offset_seconds ?? 0) * 1000;
  // Open-Meteo times are local wall-clock strings without zone; compare in the same frame.
  const localNow = now.getTime() + offset;
  let idx = 0;
  for (let i = 0; i < h.time.length; i++) {
    if (Date.parse(`${h.time[i]}Z`) <= localNow) idx = i;
  }
  const p = h.surface_pressure[idx];
  const p24 = h.surface_pressure[idx - 24];
  const t = h.temperature_2m[idx];
  if (p == null || p24 == null || t == null) return null;
  return { pressure: p, delta24: Math.round((p - p24) * 10) / 10, tempC: t, place, source };
}

export async function fetchWeather(
  coords: { lat: number; lon: number; place: string } = LONDON,
  source: Weather["source"] = "fallback",
  signal?: AbortSignal,
): Promise<Weather | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat.toFixed(3)}&longitude=${coords.lon.toFixed(3)}` +
    `&hourly=surface_pressure,temperature_2m&past_days=1&forecast_days=1&timezone=auto`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  return parseOpenMeteo((await res.json()) as OpenMeteoHourly, new Date(), coords.place, source);
}

/** Browser geolocation (asked only after the person presses Start), falling back to London. */
export const locate = (): Promise<{ lat: number; lon: number; place: string; live: boolean }> =>
  new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve({ ...LONDON, live: false });
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, place: "your location", live: true }),
      () => resolve({ ...LONDON, live: false }),
      { timeout: 6000, maximumAge: 30 * 60 * 1000 },
    );
  });
