import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const UA = 'OfertasJuegos/0.1 (proyecto personal; github.com/CarlosM0905)';
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson(url, { retries = 3, headers = {}, method = 'GET', body, ua = UA, timeout = 30000 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        method,
        body,
        headers: { 'user-agent': ua, accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(timeout),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${url.slice(0, 120)}`);
        err.fatal = true;
        throw err;
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (e.fatal) break;
      await sleep(1500 * (i + 1) ** 2);
    }
  }
  throw lastErr;
}

/** Ejecuta `fn` sobre `items` con concurrencia limitada. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

export const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeJson(path, data, pretty = false) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, pretty ? 2 : 0) + '\n');
}

/** Convierte "US$39.99", "S/160,00", "$1.299,00" en número. */
export function parsePrice(text) {
  if (text == null) return null;
  if (typeof text === 'number') return text;
  const s = String(text).replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let norm;
  if (lastComma > lastDot) norm = s.replace(/\./g, '').replace(',', '.');
  else norm = s.replace(/,/g, '');
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

const EDITION_WORDS = /\b(nintendo switch 2 edition|switch 2 edition|ps4 (&|and) ps5|ps5 (&|and) ps4|ps4™? ?(&|y) ?ps5™?|ps5|ps4|remastered|game of the year edition|goty edition|goty|definitive edition|complete edition|deluxe edition|digital deluxe edition|standard edition|ultimate edition|gold edition|director'?s cut|edici[oó]n (est[aá]ndar|deluxe|definitiva|completa|digital deluxe|del juego del a[nñ]o)|for nintendo switch)\b/g;

/** Normaliza un título para comparar entre tiendas y con Metacritic. */
export function normalizeTitle(title) {
  return String(title)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[™®©]/g, '')
    .replace(/[–—:]/g, ' ')
    .replace(EDITION_WORDS, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const round2 = (n) => Math.round(n * 100) / 100;
