import { readJson, writeJson, normalizeTitle, round2 } from './util.js';
import { fetchRates, toPEN } from './fx.js';
import { fillScores, scoreOf } from './scores.js';
import { classify, inWishlist, shouldNotify } from './rules.js';
import { fetchPcDeals, fetchPcHistoricLows } from './sources/pc.js';
import { fetchPlayStationDeals } from './sources/playstation.js';
import { fetchAmericasDeals, fetchEuropeDeals, fetchJapanDeals, mergeZones, fetchRegionPrices, cachedPrices, COUNTRY_NAMES } from './sources/nintendo.js';
import { send, esc, readCommands, telegramEnabled } from './telegram.js';
import { translateJapaneseTitles } from './translate.js';

const DRY = process.argv.includes('--dry');
const PANEL_URL = process.env.PANEL_URL || '';
const today = new Date().toISOString().slice(0, 10);
const P = {
  deals: 'docs/data/deals.json',
  history: 'docs/data/history.json',
  scores: 'state/scores.json',
  prices: 'state/prices.json',
  jpTitles: 'state/jp-titles.json',
  notified: 'state/notified.json',
  state: 'state/state.json',
  wishlist: 'state/wishlist.json',
};

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const cut = (price, regular) => (regular > 0 ? Math.round((1 - price / regular) * 100) : 0);
const money = (n) => `S/${n.toFixed(2)}`;

async function main() {
  const config = await readJson('config.json');
  const scores = await readJson(P.scores, {});
  const priceCache = await readJson(P.prices, {});
  const jpTitles = await readJson(P.jpTitles, {});
  const notified = await readJson(P.notified, {});
  const state = await readJson(P.state, { tgOffset: 0, rates: null, lastSummary: null, baseline: false });
  let wishlist = await readJson(P.wishlist, []);
  const history = await readJson(P.history, {});
  const errors = [];

  const rates = await fetchRates(state.rates);
  state.rates = rates;
  const usd = (n) => toPEN(n, 'USD', rates);

  // ---------- Comandos de Telegram ----------
  const replies = [];
  try {
    const { commands, offset } = await readCommands(state.tgOffset);
    state.tgOffset = offset;
    for (const { cmd, arg } of commands) {
      if (cmd === 'seguir' && arg) {
        if (!wishlist.some((w) => normalizeTitle(w) === normalizeTitle(arg))) wishlist.push(arg);
        replies.push(`⭐ Sigo <b>${esc(arg)}</b>. Te aviso con cualquier descuento.`);
      } else if (cmd === 'dejar' && arg) {
        const before = wishlist.length;
        wishlist = wishlist.filter((w) => normalizeTitle(w) !== normalizeTitle(arg));
        replies.push(before === wishlist.length ? `No tenía <b>${esc(arg)}</b> en la lista.` : `Listo, dejé de seguir <b>${esc(arg)}</b>.`);
      } else if (cmd === 'lista') {
        replies.push(wishlist.length ? `⭐ Tu lista:\n${wishlist.map((w) => `• ${esc(w)}`).join('\n')}` : 'Tu lista está vacía. Usa /seguir nombre del juego');
      } else if (cmd === 'resumen') {
        state.forceSummary = true;
      } else {
        replies.push('Comandos:\n/seguir nombre — avisarme de ese juego siempre\n/dejar nombre — quitarlo\n/lista — ver mi lista\n/resumen — mejores ofertas ahora');
      }
    }
  } catch (e) {
    errors.push(`telegram: ${e.message}`);
  }

  // ---------- Fuentes ----------
  const safe = async (name, fn) => {
    try {
      const t = Date.now();
      const r = await fn();
      log(`${name}: ${r.length} (${((Date.now() - t) / 1000).toFixed(0)} s)`);
      return r;
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
      log(`${name}: ERROR ${e.message}`);
      return [];
    }
  };
  const [pc, ps, swAm, swEu, swJp] = await Promise.all([
    safe('PC', () => fetchPcDeals(config.pc)),
    safe('PlayStation', () => fetchPlayStationDeals(config.ps)),
    safe('Switch América', fetchAmericasDeals),
    safe('Switch Europa', fetchEuropeDeals),
    safe('Switch Japón', fetchJapanDeals),
  ]);
  // Títulos solo en japonés: pedir el nombre oficial en inglés para poder emparejarlos.
  const jpOnly = swJp.filter((i) => !i.keys.length);
  try {
    const tr = await translateJapaneseTitles(jpTitles, jpOnly.map((i) => i.title), config.traduccion);
    if (tr.omitido) log(`Japón: ${jpOnly.length} títulos solo en japonés (sin Azure OpenAI configurado, no se traducen)`);
    else log(`Japón: ${tr.traducidos} títulos traducidos, ${tr.pendientes} pendientes`);
  } catch (e) {
    errors.push(`traducción: ${e.message}`);
  }
  for (const i of jpOnly) {
    const en = jpTitles[i.title]?.en;
    if (en) {
      i.titleEn = en;
      i.keys = [normalizeTitle(en)];
    }
  }
  // Títulos traducidos por IA: en Metacritic solo se aceptan coincidencias exactas.
  const translatedKeys = new Set(jpOnly.filter((i) => i.titleEn).map((i) => i.keys[0]));
  const switchGames = mergeZones(swAm, swEu, swJp);
  log(`Switch: ${switchGames.length} juegos tras juntar zonas`);

  // PS: un juego puede salir varias veces (PS4/PS5, ediciones): nos quedamos con el más barato.
  const psByTitle = new Map();
  for (const d of ps) {
    const k = normalizeTitle(d.title);
    const prev = psByTitle.get(k);
    if (!prev || d.usd < prev.usd || (d.usd === prev.usd && d.platforms.includes('PS5'))) psByTitle.set(k, d);
  }

  // ---------- Notas (Metacritic) ----------
  for (const d of pc) {
    const n = normalizeTitle(d.title);
    if (d.metacritic && !scores[n]) scores[n] = { s: d.metacritic, slug: null, t: Date.now() };
  }
  const minCut = config.reglas.descuentoMinimo;
  const titles = [
    ...pc.filter((d) => cut(d.usd, d.usdRegular) >= minCut).map((d) => d.title),
    ...[...psByTitle.values()].filter((d) => cut(d.usd, d.usdRegular) >= minCut).map((d) => d.title),
    ...switchGames.filter((g) => g.keys.length).map((g) => g.keys[0]),
  ];
  const sr = await fillScores(scores, titles, { max: Number(process.env.NOTAS_MAX) || config.notas.maxBusquedasPorCorrida, retryDays: config.notas.reintentarSinNotaDias, save: () => writeJson(P.scores, scores), strict: translatedKeys });
  log(`Metacritic: ${sr.buscados} buscados, ${sr.pendientes} pendientes para la próxima, ${sr.errores} errores`);

  // ---------- Armar ofertas ----------
  const deals = [];
  const pushDeal = (d) => {
    d.tier = classify(d, config.reglas, wishlist);
    d.wish = inWishlist(d.title, wishlist);
    if (d.tier || (d.score != null && d.score >= config.reglas.notaMedia)) deals.push(d);
  };

  for (const d of pc) {
    const sc = scoreOf(scores, d.title);
    pushDeal({
      key: `pc:${d.gameID}`, plat: 'pc', platLabel: 'PC', title: d.title, img: d.img, url: d.url, store: d.store,
      pen: usd(d.usd), penRegular: usd(d.usdRegular), usd: d.usd, cut: cut(d.usd, d.usdRegular),
      score: sc.score, scoreUrl: sc.url, steam: d.steamRating, gameID: d.gameID,
    });
  }

  for (const d of psByTitle.values()) {
    const sc = scoreOf(scores, d.title);
    pushDeal({
      key: `ps:${normalizeTitle(d.title)}`, plat: 'ps', platLabel: d.platforms.includes('PS5') ? 'PS5' : 'PS4', title: d.title,
      img: d.img, url: d.url, pen: usd(d.usd), penRegular: usd(d.usdRegular), usd: d.usd, cut: cut(d.usd, d.usdRegular),
      score: sc.score, scoreUrl: sc.url, plus: d.plus,
    });
  }

  // Switch: precios por país solo de los juegos que podrían interesar (con nota o en la wishlist).
  const swCandidates = switchGames.filter((g) => {
    const sc = g.keys.length ? scoreOf(scores, g.keys[0]).score : null;
    return sc != null || inWishlist(g.title, wishlist) || g.keys.some((k) => inWishlist(k, wishlist));
  });
  const nsuidsByZone = { americas: [], europa: [] };
  for (const g of swCandidates) for (const [z, id] of Object.entries(g.nsuids)) if (z !== 'japon') nsuidsByZone[z].push(id);
  const pr = await fetchRegionPrices(nsuidsByZone, priceCache, config.preciosSwitch);
  log(`Switch: ${swCandidates.length} candidatos · ${pr.refreshed} precios actualizados (${pr.calls} llamadas), ${pr.pending} esperan turno${pr.blocked ? ' · ⚠️ Nintendo bloqueó (403), se usa caché' : ''}`);
  if (pr.blocked) errors.push('eShop: Nintendo respondió 403, se usaron precios en caché');
  // Olvidar precios de juegos que ya no están en oferta en ninguna zona.
  const liveIds = new Set(Object.values(nsuidsByZone).flat());
  for (const id of Object.keys(priceCache)) if (!liveIds.has(id)) delete priceCache[id];

  for (const g of swCandidates) {
    const regions = [];
    for (const [zone, id] of Object.entries(g.nsuids)) {
      for (const [country, p] of Object.entries(cachedPrices(priceCache, id, g.catalog[zone]))) {
        const pen = toPEN(p.price, p.currency, rates);
        if (pen == null) continue;
        regions.push({
          c: country, name: COUNTRY_NAMES[country] || country, pen, penRegular: toPEN(p.regular, p.currency, rates),
          price: p.price, cur: p.currency, ends: p.ends, cut: cut(p.price, p.regular), zone,
        });
      }
    }
    if (!regions.length) continue;
    regions.sort((a, b) => a.pen - b.pen);
    const best = regions[0];
    const sc = g.keys.length ? scoreOf(scores, g.keys[0]) : { score: null, url: null };
    pushDeal({
      key: `sw:${g.platform === 'Switch 2' ? 's2' : 's1'}:${g.keys[0] || g.nsuids.japon}`, plat: 'switch', platLabel: g.platform,
      title: g.title, titleJp: g.titleJp, img: g.img, url: g.urls[best.zone] || Object.values(g.urls)[0], urls: g.urls,
      pen: best.pen, penRegular: best.penRegular, cut: best.cut, best: best.c, bestName: best.name,
      pe: regions.find((r) => r.c === 'PE')?.pen ?? null,
      score: sc.score, scoreUrl: sc.url, regions,
    });
  }

  // ---------- Mínimos históricos ----------
  const pcTiered = deals.filter((d) => d.plat === 'pc' && d.tier);
  const lows = pcTiered.length ? await fetchPcHistoricLows(pcTiered.map((d) => d.gameID)) : new Map();
  for (const d of deals) {
    const h = (history[d.key] ||= []);
    const last = h[h.length - 1];
    if (last?.[0] === today) last[1] = Math.min(last[1], d.pen);
    else h.push([today, d.pen]);
    if (h.length > 180) h.splice(0, h.length - 180);
    const seenMin = Math.min(...h.map((x) => x[1]));
    d.low = seenMin;
    d.isLow = h.length > 1 && d.pen <= seenMin + 0.01;
    if (d.plat === 'pc' && lows.has(d.gameID)) {
      const lowPen = usd(lows.get(d.gameID));
      d.low = Math.min(d.low, lowPen);
      d.isLow = d.usd <= lows.get(d.gameID) + 0.01;
    }
    d.since = h.find((x) => x[1] === d.pen)?.[0] || today;
  }
  // Olvidar historiales que no se ven hace 120 días.
  const cutoff = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  for (const [k, h] of Object.entries(history)) if (!h.length || h[h.length - 1][0] < cutoff) delete history[k];

  const tierOrder = { wishlist: 0, top: 1, buena: 2, barata: 3 };
  deals.sort((a, b) => (tierOrder[a.tier] ?? 9) - (tierOrder[b.tier] ?? 9) || (b.score ?? 0) - (a.score ?? 0) || a.pen - b.pen);

  // ---------- Avisos ----------
  const tiered = deals.filter((d) => d.tier);
  const toNotify = tiered.filter((d) => shouldNotify(d.key, d.pen, notified));
  const live = new Set(tiered.map((d) => d.key));
  for (const k of Object.keys(notified)) if (!live.has(k)) delete notified[k];

  const messages = [...replies];
  if (!state.baseline) {
    // Arranque: mientras se llena el caché de precios no avisamos (cada juego
    // "encontraría" un país más barato). Se activa cuando el caché está completo.
    if (pr.pending === 0 && !pr.blocked) {
      messages.push(`🎮 <b>Ofertas Gamer activo</b>\nEstoy vigilando ${tiered.length} ofertas que cumplen tus reglas. Desde ahora te aviso solo de las nuevas.${PANEL_URL ? `\n<a href="${PANEL_URL}">Abrir panel</a>` : ''}`);
      state.baseline = true;
    } else {
      log(`Arranque: ${pr.pending} precios de Switch por cargar, todavía sin avisos`);
    }
  } else if (toNotify.length) {
    const max = config.telegram.maxPorMensaje;
    const lines = toNotify.slice(0, max).map(formatDeal);
    const extra = toNotify.length > max ? `\n…y ${toNotify.length - max} más en el panel.` : '';
    messages.push(`🔥 <b>${toNotify.length} oferta${toNotify.length > 1 ? 's' : ''} nueva${toNotify.length > 1 ? 's' : ''}</b>\n\n${lines.join('\n\n')}${extra}`);
  }
  for (const d of tiered) if (shouldNotify(d.key, d.pen, notified)) notified[d.key] = d.pen;

  // Resumen diario (primera corrida después de las 8:00 de Lima = 13:00 UTC) o a pedido.
  const limaHour = (new Date().getUTCHours() + 19) % 24;
  if (state.forceSummary || (state.baseline && state.lastSummary !== today && limaHour >= 8)) {
    const top = tiered.filter((d) => d.tier !== 'barata').slice(0, 10);
    if (top.length) messages.push(`☀️ <b>Lo mejor de hoy</b>\n\n${top.map(formatDeal).join('\n\n')}${PANEL_URL ? `\n\n<a href="${PANEL_URL}">Ver todo</a>` : ''}`);
    state.lastSummary = today;
    delete state.forceSummary;
  }

  for (const m of messages) {
    if (DRY || !telegramEnabled()) console.log('\n--- Telegram ---\n' + m.replace(/<[^>]+>/g, ''));
    else await send(m).catch((e) => errors.push(`telegram envío: ${e.message}`));
  }

  // ---------- Guardar ----------
  const counts = { pc: 0, ps: 0, switch: 0 };
  for (const d of deals) counts[d.plat]++;
  await writeJson(P.deals, {
    updatedAt: new Date().toISOString(),
    rates: { USD: round2(rates.PEN), JPY: round2(rates.PEN / rates.JPY * 100), EUR: round2(rates.PEN / rates.EUR) },
    reglas: config.reglas,
    leidos: { pc: pc.length, ps: psByTitle.size, switch: switchGames.length },
    counts,
    errors,
    wishlist,
    deals: deals.map(({ gameID, ...d }) => d),
  });
  await writeJson(P.history, history);
  await writeJson(P.scores, scores);
  await writeJson(P.prices, priceCache);
  await writeJson(P.jpTitles, jpTitles, true);
  await writeJson(P.notified, notified, true);
  await writeJson(P.state, state, true);
  await writeJson(P.wishlist, wishlist, true);
  log(`Listo: ${deals.length} en panel, ${tiered.length} cumplen reglas, ${toNotify.length} avisos. Errores: ${errors.length}`);
  if (errors.length) console.log(errors.join('\n'));
}

const TIER_ICON = { wishlist: '⭐', top: '🏆', buena: '👍', barata: '🪙' };
function formatDeal(d) {
  const nota = d.score != null ? ` · MC ${d.score}` : '';
  const where = d.plat === 'switch' ? ` en ${d.bestName}${d.pe != null && d.best !== 'PE' ? ` (Perú ${money(d.pe)})` : ''}` : d.store ? ` en ${d.store}` : '';
  const low = d.isLow ? ' · 📉 mínimo histórico' : '';
  const plus = d.plus ? ' · requiere PS Plus' : '';
  return `${TIER_ICON[d.tier] || ''} <b>${esc(d.title)}</b> [${d.platLabel}]${nota}\n<s>${money(d.penRegular)}</s> → <b>${money(d.pen)}</b> (-${d.cut}%)${esc(where)}${low}${plus}\n<a href="${d.url}">Ir a la tienda</a>${PANEL_URL ? ` · <a href="${PANEL_URL}#juego=${encodeURIComponent(d.key)}">Comparar precios</a>` : ''}`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
