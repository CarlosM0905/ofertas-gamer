const $ = (s) => document.querySelector(s);
const state = { plat: 'all', tier: 'ok', q: '', sort: 'rel', max: null, low: false, noplus: false };
let data = null;
let history = null;

const money = (n) => (n == null ? '—' : `S/${n.toFixed(2)}`);
const scoreClass = (s) => (s == null ? 'n' : s >= 80 ? 'g' : s >= 60 ? 'm' : 'b');
// Los emoji de bandera no se ven en Windows: usamos imágenes.
const flag = (c) => (c ? `<img class="flag" src="https://flagcdn.com/20x15/${c === 'DE' ? 'eu' : c.toLowerCase()}.png" alt="${c}" width="20" height="15">` : '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function restore() {
  try {
    Object.assign(state, JSON.parse(localStorage.getItem('filtros') || '{}'), { q: '' });
  } catch {}
}
function persist() {
  try {
    localStorage.setItem('filtros', JSON.stringify({ ...state, q: '' }));
  } catch {}
}

async function load() {
  const res = await fetch(`data/deals.json?t=${Date.now()}`);
  data = await res.json();
  const ago = Math.round((Date.now() - new Date(data.updatedAt)) / 60000);
  const agoTxt = ago < 60 ? `hace ${ago} min` : `hace ${Math.round(ago / 60)} h`;
  $('#meta').textContent = `Actualizado ${agoTxt} · US$1 = S/${data.rates.USD} · ¥100 = S/${data.rates.JPY}`;
  render();
}

function filtered() {
  const q = state.q.trim().toLowerCase();
  let list = data.deals.filter((d) => {
    if (state.plat !== 'all' && d.plat !== state.plat) return false;
    if (state.tier === 'ok' && !d.tier) return false;
    if (!['ok', 'all'].includes(state.tier) && d.tier !== state.tier) return false;
    if (q && !d.title.toLowerCase().includes(q)) return false;
    if (state.max && d.pen > state.max) return false;
    if (state.low && !d.isLow) return false;
    if (state.noplus && d.plus) return false;
    return true;
  });
  const by = {
    score: (a, b) => (b.score ?? 0) - (a.score ?? 0) || a.pen - b.pen,
    price: (a, b) => a.pen - b.pen,
    cut: (a, b) => b.cut - a.cut,
    new: (a, b) => (b.since || '').localeCompare(a.since || ''),
  }[state.sort];
  if (by) list = [...list].sort(by);
  return list;
}

function card(d, i) {
  const whereHtml = d.plat === 'switch' ? `${flag(d.best)} ${esc(d.bestName)}${d.pe != null && d.best !== 'PE' ? ` · Perú ${money(d.pe)}` : ''}` : esc(d.store || 'PS Store Perú');
  return `<button class="card" data-i="${i}">
    <div class="thumb ${d.plat === 'switch' ? 'square' : ''}">
      ${d.img ? `<img loading="lazy" src="${esc(d.img)}" alt="">` : ''}
      <div class="badges"><span class="plat ${d.plat}">${esc(d.platLabel)}</span><span class="score ${scoreClass(d.score)}">${d.score ?? '—'}</span></div>
    </div>
    <div class="body">
      <div class="title">${esc(d.title)}</div>
      <div class="price"><span class="now">${money(d.pen)}</span><s>${money(d.penRegular)}</s><span class="cut">-${d.cut}%</span></div>
      <div class="where">${whereHtml}</div>
      <div class="tags">
        ${d.isLow ? '<span class="tag low">📉 Mínimo histórico</span>' : ''}
        ${d.wish ? '<span class="tag wish">⭐ En tu lista</span>' : ''}
        ${d.plus ? '<span class="tag">PS Plus</span>' : ''}
      </div>
    </div>
  </button>`;
}

let current = [];
function render() {
  current = filtered();
  $('#grid').innerHTML = current.slice(0, 300).map(card).join('');
  $('#empty').hidden = current.length > 0;
  const extra = current.length > 300 ? ' (mostrando 300)' : '';
  $('#count').textContent = `${current.length} ofertas${extra} · revisadas ${data.leidos.pc} en PC, ${data.leidos.ps} en PS, ${data.leidos.switch} en Switch`;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.plat === state.plat));
  document.querySelectorAll('#tiers button').forEach((b) => b.classList.toggle('on', b.dataset.tier === state.tier));
  persist();
}

function chartSvg(points) {
  if (!points || points.length < 2) return '<p class="muted">El historial se arma con cada revisión; vuelve en unos días.</p>';
  const W = 640, H = 160, P = 30;
  const ys = points.map((p) => p[1]);
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = max - min || 1;
  const x = (i) => P + (i * (W - P * 2)) / (points.length - 1);
  const y = (v) => H - 20 - ((v - min) / span) * (H - 40);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    <text x="2" y="${y(max) + 4}">S/${max.toFixed(0)}</text><text x="2" y="${y(min) + 4}">S/${min.toFixed(0)}</text>
    <text x="${P}" y="${H - 4}">${points[0][0]}</text><text x="${W - P}" y="${H - 4}" text-anchor="end">${points[points.length - 1][0]}</text>
  </svg>`;
}

async function openDetail(d) {
  const dlg = $('#detail');
  const regions = d.regions
    ? `<div class="d-sec"><h3>Precio por país</h3><table class="regions">${d.regions
        .map((r, i) => `<tr class="${r.c === 'PE' ? 'pe' : ''}"><td>${i < 3 ? ['🥇', '🥈', '🥉'][i] : ''} ${flag(r.c)} ${esc(r.name)}${r.cut > 0 ? ` <span class="cut">-${r.cut}%</span>` : ''}</td>
          <td>${r.cut > 0 ? `<s>${money(r.penRegular)}</s>` : ''}<b>${money(r.pen)}</b> <span class="orig">${r.price} ${r.cur}</span></td></tr>`)
        .join('')}</table></div>`
    : '';
  dlg.innerHTML = `
    <div class="d-head">
      ${d.img ? `<img src="${esc(d.img)}" alt="">` : ''}
      <div>
        <h2>${esc(d.title)}</h2>
        <div class="price"><span class="now">${money(d.pen)}</span><s>${money(d.penRegular)}</s><span class="cut">-${d.cut}%</span></div>
        <p class="muted">${esc(d.platLabel)} · Metacritic ${d.score ?? 'sin nota'} · más bajo visto ${money(d.low)}${d.plus ? ' · requiere PS Plus' : ''}</p>
      </div>
      <button class="d-close" aria-label="Cerrar">✕</button>
    </div>
    <div class="d-sec links">
      <a class="btn" href="${esc(d.url)}" target="_blank" rel="noopener">Ir a la tienda</a>
      ${d.urls?.japon && d.best !== 'JP' ? `<a class="btn alt" href="${esc(d.urls.japon)}" target="_blank" rel="noopener">eShop Japón</a>` : ''}
      ${d.scoreUrl ? `<a class="btn alt" href="${esc(d.scoreUrl)}" target="_blank" rel="noopener">Metacritic</a>` : ''}
    </div>
    ${regions}
    <div class="d-sec"><h3>Historial de precio (S/)</h3><div id="hist">Cargando…</div></div>`;
  dlg.querySelector('.d-close').onclick = () => dlg.close();
  dlg.showModal();
  if (!history) history = await fetch(`data/history.json?t=${Date.now()}`).then((r) => r.json()).catch(() => ({}));
  const h = dlg.querySelector('#hist');
  if (h) h.innerHTML = chartSvg(history[d.key]);
}

$('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) { state.plat = b.dataset.plat; render(); } };
$('#tiers').onclick = (e) => { const b = e.target.closest('button'); if (b) { state.tier = b.dataset.tier; render(); } };
$('#grid').onclick = (e) => { const c = e.target.closest('.card'); if (c) openDetail(current[+c.dataset.i]); };
$('#detail').onclick = (e) => { if (e.target.id === 'detail') e.target.close(); };
$('#q').oninput = (e) => { state.q = e.target.value; render(); };
$('#sort').onchange = (e) => { state.sort = e.target.value; render(); };
$('#max').oninput = (e) => { state.max = Number(e.target.value) || null; render(); };
$('#low').onchange = (e) => { state.low = e.target.checked; render(); };
$('#noplus').onchange = (e) => { state.noplus = e.target.checked; render(); };

restore();
$('#sort').value = state.sort;
$('#max').value = state.max ?? '';
$('#low').checked = state.low;
$('#noplus').checked = state.noplus;
load().catch(() => ($('#meta').textContent = 'No se pudieron cargar las ofertas.'));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
