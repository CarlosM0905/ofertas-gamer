import { fetchJson, round2 } from './util.js';

/** Tipos de cambio con base USD (open.er-api.com, gratis y sin clave). */
export async function fetchRates(fallback) {
  try {
    const res = await fetchJson('https://open.er-api.com/v6/latest/USD');
    if (res.result === 'success' && res.rates?.PEN) return res.rates;
  } catch (e) {
    console.warn(`  tipo de cambio: ${e.message}`);
  }
  if (fallback?.PEN) return fallback;
  throw new Error('No hay tipo de cambio disponible');
}

export function toPEN(amount, currency, rates) {
  if (amount == null || !rates[currency]) return null;
  return round2((amount / rates[currency]) * rates.PEN);
}
