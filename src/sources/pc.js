import { fetchJson, sleep, chunk } from '../util.js';

const API = 'https://www.cheapshark.com/api/1.0';

/** Ofertas de PC (Steam, GOG, Epic, Humble, Fanatical...) vía CheapShark, en USD. */
export async function fetchPcDeals({ tiendas, paginas }) {
  const stores = await fetchJson(`${API}/stores`);
  const storeName = Object.fromEntries(stores.map((s) => [s.storeID, s.storeName]));
  const byGame = new Map();
  const add = (d) => {
    const price = Number(d.salePrice);
    const prev = byGame.get(d.gameID);
    if (prev && prev.usd <= price) return;
    byGame.set(d.gameID, {
      gameID: d.gameID,
      title: d.title,
      store: storeName[d.storeID] || `Tienda ${d.storeID}`,
      img: d.steamAppID ? `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${d.steamAppID}/header.jpg` : d.thumb,
      url: `https://www.cheapshark.com/redirect?dealID=${d.dealID}`,
      usd: price,
      usdRegular: Number(d.normalPrice),
      metacritic: Number(d.metacriticScore) || null,
      steamRating: Number(d.steamRatingPercent) || null,
    });
  };
  const queries = [
    { sortBy: 'Deal Rating', pages: paginas },
    { sortBy: 'Metacritic', metacritic: '75', pages: Math.ceil(paginas / 2) },
  ];
  for (const q of queries) {
    for (let page = 0; page < q.pages; page++) {
      const qs = new URLSearchParams({
        storeID: tiendas.join(','),
        onSale: '1',
        pageSize: '60',
        pageNumber: String(page),
        sortBy: q.sortBy,
        ...(q.metacritic ? { metacritic: q.metacritic } : {}),
      });
      const deals = await fetchJson(`${API}/deals?${qs}`);
      deals.forEach(add);
      if (deals.length < 60) break;
      await sleep(1200); // CheapShark limita fuerte
    }
  }
  return [...byGame.values()];
}

/** Precio más bajo histórico (USD) por gameID, hasta 25 por llamada. */
export async function fetchPcHistoricLows(gameIDs) {
  const lows = new Map();
  for (const ids of chunk(gameIDs, 25)) {
    try {
      const res = await fetchJson(`${API}/games?ids=${ids.join(',')}`);
      for (const [id, g] of Object.entries(res)) {
        if (g?.cheapestPriceEver?.price) lows.set(id, Number(g.cheapestPriceEver.price));
      }
    } catch (e) {
      console.warn(`  históricos PC: ${e.message}`);
    }
    await sleep(1200);
  }
  return lows;
}
