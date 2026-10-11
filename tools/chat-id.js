// Muestra el chat ID de quien le escribió al bot. Uso:
//   TELEGRAM_TOKEN=xxx npm run chat-id
// Antes, mándale cualquier mensaje a tu bot desde Telegram.
const token = process.env.TELEGRAM_TOKEN;
if (!token) {
  console.error('Falta TELEGRAM_TOKEN. Uso: TELEGRAM_TOKEN=tu_token npm run chat-id');
  process.exit(1);
}
const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`).then((r) => r.json());
if (!res.ok) {
  console.error(`Telegram respondió: ${res.description}`);
  process.exit(1);
}
const chats = new Map();
for (const u of res.result) {
  const c = u.message?.chat;
  if (c) chats.set(c.id, c.first_name || c.title || c.username || '');
}
if (!chats.size) console.log('No hay mensajes. Escríbele algo a tu bot y vuelve a correr esto.');
for (const [id, name] of chats) console.log(`${name}: ${id}`);
