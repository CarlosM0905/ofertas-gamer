import { fetchJson, sleep, parsePrice, BROWSER_UA } from '../util.js';

const GQL = 'https://web.np.playstation.com/api/graphql/v1/op';
const HASH = '4ce7d410a4db2c8b635a48c1dcec375906ff63b19dadd87e073f8fd0c0481d35';
const CLASSES = ['FULL_GAME', 'PREMIUM_EDITION', 'GAME_BUNDLE'];
const PAGE = 100;

function pickImage(media = []) {
  const img = (role) => media.find((m) => m.type === 'IMAGE' && m.role === role)?.url;
  return img('MASTER') || img('GAMEHUB_COVER_ART') || img('EDITION_KEY_ART') || media.find((m) => m.type === 'IMAGE')?.url || null;
}

/** Ofertas de la PlayStation Store de Perú (precios en USD). */
export async function fetchPlayStationDeals({ categoria, locale, plataformas }) {
  const out = [];
  const lang = locale.toLowerCase();
  for (const cls of CLASSES) {
    for (let offset = 0; offset < 10000; offset += PAGE) {
      const variables = {
        id: categoria,
        pageArgs: { size: PAGE, offset },
        sortBy: null,
        filterBy: [`storeDisplayClassification:${cls}`],
        facetOptions: [],
      };
      const qs = new URLSearchParams({
        operationName: 'categoryGridRetrieve',
        variables: JSON.stringify(variables),
        extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: HASH } }),
      });
      const res = await fetchJson(`${GQL}?${qs}`, {
        ua: BROWSER_UA,
        headers: { 'x-psn-store-locale-override': locale, 'content-type': 'application/json' },
      });
      const grid = res.data?.categoryGridRetrieve;
      if (!grid) throw new Error('PS Store: respuesta inesperada (¿cambió el hash de la consulta?)');
      for (const p of grid.products || []) {
        const pr = p.price;
        if (!pr || pr.isFree) continue;
        if (!p.platforms?.some((x) => plataformas.includes(x))) continue;
        const price = parsePrice(pr.discountedPrice);
        const regular = parsePrice(pr.basePrice);
        if (price == null || regular == null || price >= regular) continue;
        out.push({
          id: p.id,
          title: p.name,
          platforms: p.platforms,
          img: pickImage(p.media),
          url: `https://store.playstation.com/${lang}/product/${p.id}`,
          usd: price,
          usdRegular: regular,
          // descuento solo para suscriptores (PS Plus / EA Play)
          plus: Boolean(pr.isTiedToSubscription) || (pr.serviceBranding || []).some((b) => b !== 'NONE'),
        });
      }
      if (grid.pageInfo?.isLast || !grid.products?.length) break;
      await sleep(300);
    }
  }
  return out;
}
