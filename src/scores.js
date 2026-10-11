import { fetchJson, pool, sleep, normalizeTitle, BROWSER_UA } from './util.js';

const SEARCH = 'https://backend.metacritic.com/finder/metacritic/search';
const KEY = '1MOZgmNFxvmljaQR1X9KAij9Mo4xAY3u'; // clave pública que usa la web de Metacritic
const DAY = 86400000;

/** Elige el resultado de Metacritic que corresponde al título buscado. */
export function pickMatch(norm, items) {
  const games = items.filter((i) => i.type === 'game-title');
  const scored = games.map((i) => ({ i, n: normalizeTitle(i.title) }));
  const exact = scored.find((x) => x.n === norm);
  if (exact) return exact.i;
  const close = scored.find((x) => {
    const [a, b] = x.n.length < norm.length ? [x.n, norm] : [norm, x.n];
    return a.length >= 4 && b.startsWith(a) && b.length - a.length <= 12;
  });
  return close?.i || null;
}

async function lookup(norm) {
  const url = `${SEARCH}/${encodeURIComponent(norm)}/web?apiKey=${KEY}&componentType=Game&mcoTypeId=13&limit=8`;
  const res = await fetchJson(url, { ua: BROWSER_UA, retries: 2 });
  const hit = pickMatch(norm, res.data?.items || []);
  return {
    s: hit?.criticScoreSummary?.score ?? null,
    slug: hit?.slug ?? null,
    t: Date.now(),
  };
}

/**
 * Completa el caché de notas para los títulos dados. Solo busca los que no
 * están o los que no tenían nota y ya pasaron `retryDays`.
 */
export async function fillScores(cache, titles, { max, retryDays, save }) {
  const pending = [];
  const seen = new Set();
  for (const t of titles) {
    const norm = normalizeTitle(t);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    const c = cache[norm];
    if (!c || (c.s == null && Date.now() - c.t > retryDays * DAY)) pending.push(norm);
  }
  const todo = pending.slice(0, max);
  let errors = 0;
  let done = 0;
  let lastError = '';
  await pool(todo, 6, async (norm) => {
    try {
      cache[norm] = await lookup(norm);
    } catch (e) {
      errors++;
      lastError = e.message;
    }
    if (++done % 100 === 0) {
      console.log(`  Metacritic ${done}/${todo.length}${errors ? ` (${errors} errores, último: ${lastError})` : ''}`);
      await save?.();
    }
    await sleep(150);
  });
  return { buscados: todo.length, pendientes: pending.length - todo.length, errores: errors };
}

export function scoreOf(cache, title) {
  const c = cache[normalizeTitle(title)];
  return c ? { score: c.s, url: c.slug ? `https://www.metacritic.com/game/${c.slug}/` : null } : { score: null, url: null };
}
