import { fetchJson, chunk, sleep, normalizeTitle, parsePrice } from '../util.js';

// La eShop tiene tres "zonas" con nsuid propio. Dentro de cada zona el mismo
// nsuid sirve para todos sus países, así que basta con un catálogo por zona.
export const ZONES = {
  americas: ['PE', 'US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO'],
  europa: ['GB', 'DE', 'PL', 'CZ', 'NO', 'SE', 'DK', 'CH', 'AU', 'NZ', 'ZA'],
  japon: [], // el catálogo japonés ya trae el precio
};

export const COUNTRY_NAMES = {
  PE: 'Perú', US: 'EE.UU.', CA: 'Canadá', MX: 'México', BR: 'Brasil', AR: 'Argentina', CL: 'Chile', CO: 'Colombia',
  GB: 'Reino Unido', DE: 'Zona euro', PL: 'Polonia', CZ: 'Rep. Checa', NO: 'Noruega', SE: 'Suecia', DK: 'Dinamarca',
  CH: 'Suiza', AU: 'Australia', NZ: 'Nueva Zelanda', ZA: 'Sudáfrica', JP: 'Japón',
};

// ---------- América (Algolia de nintendo.com/us) ----------
const ALGOLIA = 'https://U3B6GR4UA3-dsn.algolia.net/1/indexes/store_game_en_us/query';
const ALGOLIA_HEADERS = {
  'X-Algolia-API-Key': 'a29c6927638bfd8cee23993e51e721c9',
  'X-Algolia-Application-Id': 'U3B6GR4UA3',
  'content-type': 'application/json',
};
// Algolia corta en 1000 resultados por consulta: partimos por rangos de precio.
const BINS = [[0, 2], [2, 4], [4, 6], [6, 8], [8, 10], [10, 13], [13, 16], [16, 20], [20, 25], [25, 30], [30, 40], [40, 55], [55, 1000]];

export async function fetchAmericasDeals() {
  const out = new Map();
  for (const [lo, hi] of BINS) {
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({
        hitsPerPage: '500',
        page: String(page),
        filters: 'topLevelFilters:"Deals" AND topLevelCategoryCode:"GAMES"',
        numericFilters: `price.finalPrice>=${lo},price.finalPrice<${hi}`,
        attributesToRetrieve: 'title,nsuid,price,platformCode,url,productImageSquare,isUpgrade,dlcType',
      });
      const res = await fetchJson(ALGOLIA, { method: 'POST', headers: ALGOLIA_HEADERS, body: JSON.stringify({ params: params.toString() }) });
      for (const h of res.hits) {
        if (!h.nsuid || h.isUpgrade || h.dlcType) continue;
        if (!/NINTENDO_SWITCH/.test(h.platformCode || '')) continue;
        out.set(h.nsuid, {
          zone: 'americas',
          nsuid: h.nsuid,
          title: h.title,
          platform: h.platformCode === 'NINTENDO_SWITCH_2' ? 'Switch 2' : 'Switch',
          img: h.productImageSquare || null,
          url: h.url ? `https://www.nintendo.com${h.url}` : null,
          keys: [normalizeTitle(h.title)],
          catalog: h.price?.finalPrice != null ? { US: { price: h.price.finalPrice, regular: h.price.regPrice ?? h.price.finalPrice, currency: 'USD', ends: null } } : {},
        });
      }
      if (page + 1 >= res.nbPages) break;
    }
  }
  return [...out.values()];
}

// ---------- Europa / Oceanía / Sudáfrica (Solr de nintendo.com/eu) ----------
const EU_SOLR = 'https://searching.nintendo-europe.com/en/select';

export async function fetchEuropeDeals() {
  const out = [];
  const rows = 1000;
  for (let start = 0; start < 20000; start += rows) {
    const qs = new URLSearchParams({
      q: '*',
      fq: 'type:GAME AND price_has_discount_b:true AND nsuid_txt:*',
      fl: 'title,nsuid_txt,system_names_txt,image_url_sq_s,url,price_discounted_f,price_regular_f',
      rows: String(rows),
      start: String(start),
      wt: 'json',
    });
    const res = await fetchJson(`${EU_SOLR}?${qs}`);
    const docs = res.response?.docs || [];
    for (const d of docs) {
      const nsuid = (d.nsuid_txt || []).find((n) => /^7001/.test(n));
      if (!nsuid) continue;
      const systems = (d.system_names_txt || []).join(' ');
      if (!/switch/i.test(systems)) continue;
      out.push({
        zone: 'europa',
        nsuid,
        title: d.title,
        platform: /switch 2/i.test(systems) ? 'Switch 2' : 'Switch',
        img: d.image_url_sq_s || null,
        url: d.url ? `https://www.nintendo.com${d.url}` : null,
        keys: [normalizeTitle(d.title)],
        catalog: d.price_discounted_f != null ? { GB: { price: d.price_discounted_f, regular: d.price_regular_f ?? d.price_discounted_f, currency: 'GBP', ends: null } } : {},
      });
    }
    if (docs.length < rows) break;
    await sleep(300);
  }
  return out;
}

// ---------- Japón (search.nintendo.jp) ----------
const JP_SEARCH = 'https://search.nintendo.jp/nintendo_soft/search.json';
const JP_FORMS = new Set(['HAC_DL', 'BEE_DL', 'HAC_DOWNLOADABLE', 'BEE_DOWNLOADABLE', 'BEE_CARD']);

/** Posibles nombres "occidentales" de un título japonés: "クライムライト／CRYMELIGHT" → ["crymelight"]. */
export function japanTitleKeys(title) {
  const parts = [title, ...String(title).split(/[／/|｜]/)];
  const keys = new Set();
  for (const p of parts) {
    if (!/[a-z]{3}/i.test(p)) continue; // sin letras latinas no se puede emparejar
    if (/[぀-ヿ一-鿿]{2}/.test(p) && parts.length > 1) continue;
    const n = normalizeTitle(p);
    if (n.length >= 3) keys.add(n);
  }
  return [...keys];
}

export async function fetchJapanDeals() {
  const out = [];
  for (let page = 1; page <= 40; page++) {
    const res = await fetchJson(`${JP_SEARCH}?opt_sshow=1&fq=sale_flg_s%3A1&limit=300&page=${page}`);
    const items = res.result?.items || [];
    for (const i of items) {
      if (i.sctg !== 'dl_soft' || !JP_FORMS.has(i.sform)) continue;
      out.push({
        zone: 'japon',
        nsuid: i.nsuid,
        title: i.title,
        platform: i.hard === '05_BEE' ? 'Switch 2' : 'Switch',
        img: i.iurl ? `https://img-eshop.cdn.nintendo.net/i/${i.iurl}.jpg` : null,
        url: `https://store-jp.nintendo.com/item/software/D${i.nsuid}`,
        keys: japanTitleKeys(i.title),
        catalog: parsePrice(i.sprice) ? { JP: { price: parsePrice(i.sprice), regular: parsePrice(i.price) ?? parsePrice(i.sprice), currency: 'JPY', ends: i.sedate ? i.sedate.replace(' ', 'T') + '+09:00' : null } } : {},
      });
    }
    if (items.length < 300) break;
    await sleep(400);
  }
  return out;
}

/**
 * Junta los catálogos de las tres zonas en "juegos" por título + plataforma.
 * Devuelve [{ title, platform, img, urls: {zona: url}, nsuids: {zona: nsuid}, keys }]
 */
export function mergeZones(americas, europa, japon) {
  const games = [];
  const index = new Map(); // `${platform}|${key}` -> game
  const add = (item) => {
    let game = null;
    for (const k of item.keys) {
      game = index.get(`${item.platform}|${k}`);
      if (game) break;
    }
    if (game && game.nsuids[item.zone]) game = null; // ya tiene esa zona: es otro juego con nombre parecido
    if (!game) {
      if (!item.keys.length && item.zone !== 'japon') return;
      game = { title: item.titleEn || item.title, platform: item.platform, img: item.img, urls: {}, nsuids: {}, catalog: {}, keys: [] };
      games.push(game);
    }
    game.nsuids[item.zone] = item.nsuid;
    game.urls[item.zone] = item.url;
    if (item.zone === 'japon' && /[぀-ヿ一-鿿]/.test(item.title)) game.titleJp = item.title;
    game.catalog[item.zone] = item.catalog || {};
    if (!game.img) game.img = item.img;
    for (const k of item.keys) {
      if (!game.keys.includes(k)) game.keys.push(k);
      index.set(`${item.platform}|${k}`, game);
    }
  };
  // América primero: su título en inglés es el "oficial" que usamos para Metacritic.
  americas.forEach(add);
  europa.forEach(add);
  japon.forEach(add);
  return games;
}

/**
 * Precios por país con la API pública de la eShop (50 nsuid por llamada).
 * Nintendo bloquea la IP (403) si se le pide mucho seguido, así que:
 *  - se guarda todo en `cache` ({ nsuid: { t, c: { PE: {...} } } }),
 *  - cada corrida gasta como mucho `budget` llamadas, de a una con pausa,
 *  - primero los nsuid sin precio, luego los más antiguos (TTL `ttlHours`),
 *  - al primer 403 se detiene y se usa lo que haya en caché.
 */
export async function fetchRegionPrices(nsuidsByZone, cache, { budget = 200, ttlHours = 6, pauseMs = 350 } = {}) {
  const now = Date.now();
  const batches = [];
  for (const [zone, nsuids] of Object.entries(nsuidsByZone)) {
    const stale = nsuids
      .filter((id) => !cache[id] || now - cache[id].t > ttlHours * 3600000)
      .sort((a, b) => (cache[a]?.t ?? 0) - (cache[b]?.t ?? 0));
    for (const ids of chunk(stale, 50)) batches.push({ zone, ids, age: cache[ids[0]]?.t ?? 0 });
  }
  batches.sort((a, b) => a.age - b.age);

  let calls = 0;
  let blocked = false;
  let refreshed = 0;
  for (const { zone, ids } of batches) {
    if (blocked || calls + ZONES[zone].length > budget) break;
    const fresh = {};
    for (const country of ZONES[zone]) {
      calls++;
      const url = `https://api.ec.nintendo.com/v1/price?country=${country}&lang=en&ids=${ids.join(',')}`;
      let res;
      try {
        res = await fetchJson(url, { retries: 1 });
      } catch (e) {
        if (/HTTP 403/.test(e.message)) {
          blocked = true;
          break;
        }
        console.warn(`  precio ${country}: ${e.message.slice(0, 80)}`);
        continue;
      } finally {
        await sleep(pauseMs);
      }
      for (const p of res.prices || []) {
        if (!p.regular_price) continue;
        const regular = parsePrice(p.regular_price.raw_value);
        const price = p.discount_price ? parsePrice(p.discount_price.raw_value) : regular;
        (fresh[p.title_id] ||= {})[country] = {
          price,
          regular,
          currency: p.regular_price.currency,
          ends: p.discount_price?.end_datetime || null,
        };
      }
    }
    if (blocked) break;
    for (const id of ids) {
      cache[id] = { t: now, c: fresh[id] || {} };
      refreshed++;
    }
  }
  const pending = batches.reduce((n, b) => n + b.ids.length, 0) - refreshed;
  return { calls, refreshed, pending, blocked };
}

/** Precios vigentes de un nsuid: descarta descuentos ya vencidos. */
export function cachedPrices(cache, nsuid, catalog = {}) {
  const out = { ...catalog };
  for (const [country, p] of Object.entries(cache[nsuid]?.c || {})) {
    const expired = p.ends && new Date(p.ends) < new Date();
    out[country] = expired ? { ...p, price: p.regular, ends: null } : p;
  }
  return out;
}
