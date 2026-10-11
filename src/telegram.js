import { fetchJson } from './util.js';

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const api = (method) => `https://api.telegram.org/bot${token}/${method}`;

export const telegramEnabled = () => Boolean(token && chatId);

/** Parte un texto en bloques ≤ max cortando entre párrafos (Telegram acepta 4096). */
export function splitMessage(text, max = 3900) {
  const parts = [];
  let cur = '';
  for (const block of text.split('\n\n')) {
    const next = cur ? `${cur}\n\n${block}` : block;
    if (next.length > max && cur) {
      parts.push(cur);
      cur = block.slice(0, max);
    } else cur = next.slice(0, max);
  }
  if (cur) parts.push(cur);
  return parts;
}

export async function send(text) {
  if (!telegramEnabled()) return;
  for (const part of splitMessage(text)) {
    await fetchJson(api('sendMessage'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: part, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  }
}

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Lee los comandos recibidos desde la última corrida (solo del chat de Carlos). */
export async function readCommands(offset) {
  if (!telegramEnabled()) return { commands: [], offset };
  const res = await fetchJson(`${api('getUpdates')}?offset=${offset}&timeout=0&allowed_updates=["message"]`);
  let next = offset;
  const commands = [];
  for (const u of res.result || []) {
    next = Math.max(next, u.update_id + 1);
    const m = u.message;
    if (!m?.text || String(m.chat.id) !== String(chatId)) continue;
    const match = m.text.trim().match(/^\/(\w+)(?:@\w+)?\s*(.*)$/s);
    if (match) commands.push({ cmd: match[1].toLowerCase(), arg: match[2].trim() });
  }
  return { commands, offset: next };
}
