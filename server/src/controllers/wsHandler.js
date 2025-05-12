// server/src/controllers/wsHandler.js
import WebSocket from 'ws';
import { translateController } from './translate.js';
import { randomUUID } from 'crypto';

const rooms = new Map(); // roomId → Set<WebSocket>

/**
 * Initializes your WebSocketServer:
 *  - binary frames → Whisper preview & translation back to sender
 *  - text frames   → broadcast original+translation to everyone in the room
 */
export function setupWebSocket(wss) {
  wss.on('connection', (ws, req) => {
    // parse room, lang, clientId
    const url        = new URL(req.url, `http://${req.headers.host}`);
    const roomId     = url.searchParams.get('room') || 'default';
    const targetLang = url.searchParams.get('lang') || 'es';
    const clientId   = url.searchParams.get('clientId') || randomUUID();
    ws.clientId      = clientId;

    // join the room
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(ws);

    ws.on('message', async (message, isBinary) => {
      console.log('[WS] got', isBinary ? 'binary' : 'string', 'from', clientId);
      try {
        /*
        if (isBinary) {
          // —— PREVIEW only —— transcribe & translate, send back to sender
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
        */
        if (isBinary) {
            // —— PREVIEW: transcribe, translate & TTS —— 
            const { text, translation, audio } = await translateController(
              Buffer.from(message),
              targetLang
            );
            ws.send(JSON.stringify({
              speaker:    'you',
              original:   text,
              translation,
              audio,       // base64 MP3
              clientId
            }));
        } else {
          // —— FINAL CHAT —— broadcast to everyone in room
          const { original, translation, clientId: senderId } = JSON.parse(message.toString());
          for (const client of rooms.get(roomId)) {
            if (client.readyState !== WebSocket.OPEN) continue;
            const speaker = client === ws ? 'you' : 'them';
            client.send(JSON.stringify({
              speaker,
              original,
              translation,
              clientId: senderId
            }));
          }
        }
      } catch (err) {
        console.error('❌ [WS] Error handling message:', err);
      }
    });

    ws.on('close', () => {
      const room = rooms.get(roomId);
      if (!room) return;
      room.delete(ws);
      if (room.size === 0) rooms.delete(roomId);
    });
  });
}
