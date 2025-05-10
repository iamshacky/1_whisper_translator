// server/src/controllers/wsHandler.js
import { translateController } from './translate.js';
import { randomUUID } from 'crypto';

const rooms = new Map(); // roomId → Set<WebSocket>

export function setupWebSocket(wss) {
  wss.on('connection', (ws, req) => {
    const url        = new URL(req.url, `http://${req.headers.host}`);
    const roomId     = url.searchParams.get('room') || 'default';
    const targetLang = url.searchParams.get('lang') || 'es';
    // grab the clientId or give them a new one
    const clientId = url.searchParams.get('clientId') || randomUUID();
    ws.clientId = clientId;

    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(ws);

    ws.on('message', async (message) => {
      try {
        // 1) Transcribe & translate
        const { text, translation } = await translateController(
          Buffer.from(message),
          targetLang
        );

        // 2) Broadcast BOTH original + translation
        for (const client of rooms.get(roomId)) {
          if (client.readyState !== ws.OPEN) continue;
          //const speaker = client === ws ? 'you' : 'them';
          //client.send(JSON.stringify({ speaker, original: text, translation }));
          const speaker = client === ws ? 'you' : 'them';
          client.send(JSON.stringify({
            speaker,
            original: text,
            translation,
            clientId   // <-- attach the origin’s ID
          }));
        }
      } catch (err) {
        console.error('❌ [WS] Error handling audio chunk:', err);
      }
    });

    ws.on('close', () => {
      rooms.get(roomId).delete(ws);
    });
  });
}
