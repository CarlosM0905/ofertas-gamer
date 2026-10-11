import { normalizeTitle } from './util.js';

/**
 * Clasifica una oferta según las reglas de Carlos:
 *  - top:      nota ≥ 80
 *  - buena:    nota 60–79 y precio bajo (≤ precioMaxMediaPEN)
 *  - barata:   nota < 60 y precio muy bajo (≤ precioMaxBajaPEN)
 *  - wishlist: está en su lista, con cualquier descuento
 * Sin nota conocida no se avisa (salvo wishlist).
 */
export function classify({ score, pen, cut, title }, reglas, wishlist = []) {
  if (inWishlist(title, wishlist)) return 'wishlist';
  if (cut < reglas.descuentoMinimo || score == null) return null;
  if (score >= reglas.notaTop) return 'top';
  if (score >= reglas.notaMedia) return pen <= reglas.precioMaxMediaPEN ? 'buena' : null;
  return pen <= reglas.precioMaxBajaPEN ? 'barata' : null;
}

export function inWishlist(title, wishlist) {
  const n = normalizeTitle(title);
  return wishlist.some((w) => {
    const wn = normalizeTitle(w);
    return wn && (n === wn || n.startsWith(wn + ' ') || n.includes(wn));
  });
}

/** ¿Hay que avisar? Si es nueva o bajó al menos 5% desde el último aviso. */
export function shouldNotify(key, pen, notified) {
  const prev = notified[key];
  return prev == null || pen < prev * 0.95;
}
