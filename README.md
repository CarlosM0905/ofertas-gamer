# Ofertas Gamer

Vigila ofertas de juegos **buenos** en PC, PlayStation (tienda de Perú) y Switch / Switch 2 (20 países), y avisa por Telegram. Incluye un panel PWA para ver todo con filtros, precio por país e historial.

## Qué revisa

| Plataforma | Fuente | Detalle |
|---|---|---|
| PC | [CheapShark](https://www.cheapshark.com) | Steam, GOG, Epic, Humble, Fanatical, GMG, etc. Trae mínimo histórico. |
| PlayStation | API de la PS Store Perú | Juegos PS5 y PS4 en oferta (precios en USD). Marca los descuentos solo para PS Plus. |
| Switch | eShop de Nintendo | **América** (PE, US, CA, MX, BR, AR, CL, CO), **Japón**, **Europa** (Reino Unido, zona euro, Polonia, Rep. Checa, Noruega, Suecia, Dinamarca, Suiza), **Australia, Nueva Zelanda y Sudáfrica**. |
| Notas | Metacritic | Nota de la crítica, con caché. |

Todo se convierte a soles con el tipo de cambio del día ([open.er-api.com](https://open.er-api.com)).

**No incluido:** Asia (Hong Kong, Taiwán, Corea, Singapur, Tailandia, Malasia). No tienen un catálogo de ofertas público accesible (la tienda de Hong Kong bloquea bots). OpenCritic tampoco, porque pide una clave de pago.

## Reglas para avisar

Configurables en `config.json` → `reglas`:

- 🏆 **Top:** nota Metacritic ≥ 80 con al menos 20% de descuento.
- 👍 **Buena y barata:** nota 60–79 y precio ≤ S/35.
- 🪙 **Regalo:** nota < 60 y precio ≤ S/12.
- ⭐ **Mi lista:** juegos que sigues, con cualquier descuento.
- Sin nota conocida no avisa (salvo que esté en tu lista).
- En Switch se usa el país más barato; el aviso también muestra el precio en Perú.
- Vuelve a avisar del mismo juego solo si baja otro 5% o más.
- Arranque silencioso: mientras se llena el caché de precios de Switch (unas 3 corridas, ~6 h) no manda avisos. Cuando termina, manda "Ofertas Gamer activo" y desde ahí avisa solo lo nuevo.
- Resumen diario con lo mejor, a partir de las 8:00 (hora de Lima).

## Comandos de Telegram

Se leen en cada revisión (cada 2 h), así que la respuesta puede tardar:

- `/seguir nombre del juego`: avisarme de ese juego siempre.
- `/dejar nombre`: dejar de seguirlo.
- `/lista`: ver la lista.
- `/resumen`: mandar ahora lo mejor del momento.

## Cómo correr

```bash
npm run scan:dry    # revisa todo e imprime los avisos sin mandarlos
npm run scan        # igual, y manda a Telegram si hay TELEGRAM_TOKEN y TELEGRAM_CHAT_ID
npm test
npm run serve       # panel en http://localhost:8080
```

La primera corrida tarda más porque busca miles de notas en Metacritic (máximo 700 por corrida; el resto queda para las siguientes).

## Precios de Switch por país

La API de precios de Nintendo bloquea la IP (403) si recibe muchos pedidos seguidos. Por eso:

- Los precios se guardan en `state/prices.json` y se refrescan cada 6 h (`config.json` → `preciosSwitch`).
- Cada corrida hace como mucho 200 llamadas, de a una y con pausa. Primero van los juegos sin precio y después los más antiguos.
- Si llega un 403, se detiene y usa el caché.
- Respaldo sin llamadas: el catálogo de cada zona ya trae un precio (EE.UU., Reino Unido y Japón). Japón usa solo su catálogo.

## Automatización

`.github/workflows/scan.yml` corre cada 2 horas en GitHub Actions y guarda `docs/data/` y `state/` en el repo. El panel se publica con GitHub Pages desde `/docs`.

Secrets del repo: `TELEGRAM_TOKEN` (de @BotFather) y `TELEGRAM_CHAT_ID`.

## Estructura

- `src/main.js`: orquesta todo (comandos de Telegram, fuentes, notas, reglas, avisos, guardado).
- `src/sources/`: `pc.js`, `playstation.js`, `nintendo.js` (las 3 zonas de la eShop y el emparejamiento por título).
- `src/scores.js`: notas de Metacritic con caché en `state/scores.json`.
- `src/rules.js`: clasificación y cuándo volver a avisar.
- `docs/`: panel PWA (HTML/JS sin compilar). `docs/data/deals.json` y `history.json` los genera el bot.
- `state/`: caché de notas, avisos enviados, wishlist y offset de Telegram.

## Limitaciones conocidas

- Switch: los juegos se emparejan entre zonas por título. Los que en Japón solo tienen nombre en japonés no se emparejan ni tienen nota.
- PS Store: usa una consulta interna con hash; si Sony la cambia, la corrida lo reporta como error.
- El historial de precios empieza el día que arrancó el bot (PC sí trae el mínimo histórico real).
