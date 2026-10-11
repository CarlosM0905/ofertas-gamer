import { AzureOpenAI } from 'openai';
import { chunk } from './util.js';

// Muchos juegos de la eShop japonesa solo tienen título en japonés
// (モンスターハンターワイルズ = Monster Hunter Wilds). Sin el nombre en inglés
// no se pueden emparejar con otras regiones ni buscar en Metacritic, así que
// le pedimos a Azure OpenAI (gpt-4o-mini, el mismo despliegue que usa
// CuentasApp) el título oficial occidental. Cada título se traduce una sola vez
// y queda en caché (state/jp-titles.json).

const env = process.env;
export const azureConfigured = () => Boolean(env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_API_KEY);

const SYSTEM = `Recibes títulos de juegos de la Nintendo eShop de Japón, uno por línea.
Para cada uno devuelve el título OFICIAL con el que se vende en Occidente (eShop de EE.UU. o Europa), tal como aparece en la tienda.
- Si el juego no salió fuera de Japón, o no estás seguro de que sea el mismo juego, devuelve en = null. Es mejor null que adivinar.
- No traduzcas literalmente: un nombre inventado no sirve, porque se usa para buscar el juego en otras tiendas y en Metacritic.
- Ignora sufijos de edición o plataforma (Nintendo Switch 2 Edition, デラックス, etc.) salvo que formen parte del nombre oficial.
- Devuelve todos los títulos, con "jp" copiado exactamente como lo recibiste.`;

// Structured outputs: el modelo debe devolver exactamente este JSON.
const SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'titulos',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['jp', 'en'],
            properties: { jp: { type: 'string' }, en: { type: ['string', 'null'] } },
          },
        },
      },
    },
  },
};

export async function translateJapaneseTitles(cache, titles, { maxPorCorrida = 400, lote = 60 } = {}) {
  if (!azureConfigured()) return { traducidos: 0, pendientes: titles.length, omitido: true };
  const deployment = env.AZURE_OPENAI_DEPLOYMENT || 'vision';
  const client = new AzureOpenAI({
    endpoint: env.AZURE_OPENAI_ENDPOINT,
    apiKey: env.AZURE_OPENAI_API_KEY,
    apiVersion: env.AZURE_OPENAI_API_VERSION || '2024-10-21',
    deployment,
  });
  const pending = [...new Set(titles)].filter((t) => !(t in cache));
  const todo = pending.slice(0, maxPorCorrida);
  let done = 0;
  for (const batch of chunk(todo, lote)) {
    let parsed;
    try {
      const res = await client.chat.completions.create({
        model: deployment,
        temperature: 0,
        response_format: SCHEMA,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: batch.join('\n') },
        ],
      });
      parsed = JSON.parse(res.choices?.[0]?.message?.content || '{}');
    } catch (e) {
      if (e?.status === 401) throw new Error('Azure OpenAI: credenciales inválidas');
      if (e?.status === 429) {
        console.warn('  traducción: límite de Azure, sigue en la próxima corrida');
        break;
      }
      console.warn(`  traducción: ${String(e.message).slice(0, 100)}`);
      continue;
    }
    const byJp = new Map((parsed.items || []).map((i) => [i.jp, i.en]));
    for (const jp of batch) {
      if (!byJp.has(jp)) continue; // no lo devolvió: se reintenta en la próxima corrida
      const en = byJp.get(jp);
      cache[jp] = { en: en && en.trim() ? en.trim() : null, t: Date.now() };
      done++;
    }
  }
  return { traducidos: done, pendientes: pending.length - done, omitido: false };
}
