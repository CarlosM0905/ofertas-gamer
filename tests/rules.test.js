import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, shouldNotify, inWishlist } from '../src/rules.js';
import { normalizeTitle, parsePrice } from '../src/util.js';
import { japanTitleKeys, mergeZones } from '../src/sources/nintendo.js';
import { pickMatch } from '../src/scores.js';

const reglas = { descuentoMinimo: 20, notaTop: 80, notaMedia: 60, precioMaxMediaPEN: 35, precioMaxBajaPEN: 12 };

test('nota 80+ con descuento es top sin importar el precio', () => {
  assert.equal(classify({ score: 85, pen: 150, cut: 30, title: 'X' }, reglas), 'top');
});

test('nota 60-79 solo si es barato', () => {
  assert.equal(classify({ score: 70, pen: 30, cut: 50, title: 'X' }, reglas), 'buena');
  assert.equal(classify({ score: 70, pen: 60, cut: 50, title: 'X' }, reglas), null);
});

test('nota bajo 60 solo si es muy barato', () => {
  assert.equal(classify({ score: 55, pen: 10, cut: 80, title: 'X' }, reglas), 'barata');
  assert.equal(classify({ score: 55, pen: 20, cut: 80, title: 'X' }, reglas), null);
});

test('sin nota o con poco descuento no avisa, salvo wishlist', () => {
  assert.equal(classify({ score: null, pen: 5, cut: 90, title: 'X' }, reglas), null);
  assert.equal(classify({ score: 95, pen: 50, cut: 10, title: 'X' }, reglas), null);
  assert.equal(classify({ score: null, pen: 100, cut: 5, title: 'Hollow Knight: Silksong' }, reglas, ['hollow knight silksong']), 'wishlist');
});

test('wishlist encuentra ediciones del mismo juego', () => {
  assert.ok(inWishlist('ELDEN RING Deluxe Edition', ['Elden Ring']));
  assert.ok(!inWishlist('Hades', ['Hades II']));
});

test('vuelve a avisar solo si baja 5% o más', () => {
  assert.ok(shouldNotify('a', 50, {}));
  assert.ok(!shouldNotify('a', 49, { a: 50 }));
  assert.ok(shouldNotify('a', 47, { a: 50 }));
});

test('normalizeTitle quita ediciones y símbolos', () => {
  assert.equal(normalizeTitle('Marvel’s Spider-Man: Game of the Year Edition'), normalizeTitle("Marvel's Spider-Man"));
  assert.equal(normalizeTitle('Dispatch Nintendo Switch 2 Edition'), 'dispatch');
  assert.equal(normalizeTitle('UFC™ 6'), 'ufc 6');
});

test('parsePrice entiende formatos de tienda', () => {
  assert.equal(parsePrice('US$39.99'), 39.99);
  assert.equal(parsePrice('S/160,00'), 160);
  assert.equal(parsePrice('$1.299,50'), 1299.5);
  assert.equal(parsePrice('1,299.50'), 1299.5);
});

test('títulos japoneses con nombre latino se pueden emparejar', () => {
  assert.deepEqual(japanTitleKeys('クライムライト／CRYMELIGHT'), ['crymelight']);
  assert.deepEqual(japanTitleKeys('Silver Pines'), ['silver pines']);
  assert.deepEqual(japanTitleKeys('ゼルダの伝説'), []);
});

test('mergeZones junta el mismo juego de distintas zonas', () => {
  const am = [{ zone: 'americas', nsuid: '1', title: 'Silver Pines', platform: 'Switch 2', keys: ['silver pines'] }];
  const eu = [{ zone: 'europa', nsuid: '2', title: 'Silver Pines', platform: 'Switch 2', keys: ['silver pines'] }];
  const jp = [
    { zone: 'japon', nsuid: '3', title: 'Silver Pines', platform: 'Switch 2', keys: ['silver pines'] },
    { zone: 'japon', nsuid: '4', title: 'Silver Pines', platform: 'Switch', keys: ['silver pines'] },
  ];
  const games = mergeZones(am, eu, jp);
  assert.equal(games.length, 2);
  assert.deepEqual(games[0].nsuids, { americas: '1', europa: '2', japon: '3' });
});

test('pickMatch elige el juego correcto de Metacritic', () => {
  const items = [
    { type: 'game-title', title: 'Red Dead Redemption 2', criticScoreSummary: { score: 97 } },
    { type: 'game-title', title: 'Red Dead Redemption', criticScoreSummary: { score: 95 } },
  ];
  assert.equal(pickMatch('red dead redemption', items).criticScoreSummary.score, 95);
  assert.equal(pickMatch('juego inexistente', items), null);
});

test('splitMessage respeta el límite de Telegram sin cortar avisos', async () => {
  const { splitMessage } = await import('../src/telegram.js');
  const text = Array.from({ length: 60 }, (_, i) => `aviso ${i} `.repeat(10)).join('\n\n');
  const parts = splitMessage(text, 1000);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 1000));
  assert.equal(parts.join('\n\n'), text);
});

test('títulos traducidos solo aceptan coincidencia exacta en Metacritic', () => {
  const items = [{ type: 'game-title', title: 'Monster Hunter: World', criticScoreSummary: { score: 90 } }];
  assert.equal(pickMatch('monster hunter worlds', items, true), null);
  assert.equal(pickMatch('monster hunter world', items, true).criticScoreSummary.score, 90);
});
