// server/src/controllers/wsHandler.js
import { translateController } from './translate.js';
import { randomUUID } from 'crypto';

const rooms = new Map(); // roomId → Set<WebSocket>

export function setupWebSocket(wss) {
  wss.on('connection', (ws, req) => {
    const url        = new URL(req.url, `http://${req.headers.host}`);
    const roomId     = url.searchParams.get('room') || 'default';
    const targetLang = url.searchParams.get('lang') || 'es';
    const clientId   = url.searchParams.get('clientId') || randomUUID();
    ws.clientId      = clientId;

    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(ws);

    ws.on('message', async (message) => {
      try {
        // Distinguish preview (binary) vs final chat (string)
        if (typeof message === 'string') {
          // FINAL: broadcast original+translation from the sender
          const { original, translation, clientId: cid } = JSON.parse(message);
          for (const client of rooms.get(roomId)) {
            if (client.readyState !== ws.OPEN) continue;
            const speaker = client === ws ? 'you' : 'them';
            client.send(JSON.stringify({ speaker, original, translation, clientId: cid }));
          }
        } else {
          // PREVIEW: just transcribe & translate back to the same client
          const { text, translation } = await translateController(
            Buffer.from(message),
            targetLang
          );
          ws.send(JSON.stringify({
            speaker:    'you',
            original:   text,
            translation,
            clientId
          }));
        }
      } catch (err) {
        console.error('❌ [WS] Error handling message:', err);
      }
    });

    ws.on('close', () => {
      rooms.get(roomId).delete(ws);
    });
  });
}
