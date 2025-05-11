import { WebSocket } from 'ws';
import { translateController } from './translate.js';
import { randomUUID } from 'crypto';

const rooms = new Map(); // roomId → Set<WebSocket>

/**
 * Initializes WebSocket routing: raw audio → preview
 * and final chat messages → broadcast.
 */
export function setupWebSocket(wss) {
  wss.on('connection', (ws, req) => {
    // Parse room, language, and clientId from URL
    const url        = new URL(req.url, `http://${req.headers.host}`);
    const roomId     = url.searchParams.get('room') || 'default';
    const targetLang = url.searchParams.get('lang') || 'es';
    const clientId   = url.searchParams.get('clientId') || randomUUID();
    ws.clientId      = clientId;

    // Track clients per room
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(ws);

    ws.on('message', async (message) => {
      console.log('[WS] got message of type', typeof message, 'from', ws.clientId);
      try {
        // Final chat: broadcast to everyone in the room
        if (typeof message === 'string') {
          console.log('[WS] chat broadcast payload:', message);
          const { original, translation, clientId: cid } = JSON.parse(message);

          for (const client of rooms.get(roomId)) {
            if (client.readyState !== WebSocket.OPEN) continue;
            const speaker = client === ws ? 'you' : 'them';
            client.send(JSON.stringify({
              speaker,
              original,
              translation,
              clientId: cid
            }));
          }

        // Preview-only: transcribe & translate, send back to sender
        } else {
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
