// server/src/controllers/wsHandler.js
import { transcribeAudio } from '../services/openaiService.js';

const rooms = new Map(); // roomId → Set<WebSocket>

export function setupWebSocket(wss) {
  wss.on('connection', (ws, req) => {
    const url    = new URL(req.url, `http://${req.headers.host}`);
    const roomId = url.searchParams.get('room') || 'default';

    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(ws);
    ws.roomId = roomId;

    console.log(`🔊 [WS] Joined room=${roomId}`);

    ws.on('message', async (message) => {
      console.log(`🔈 [WS:${roomId}] Got ${message.byteLength} bytes`);
      try {
        const text = await transcribeAudio(Buffer.from(message));
        console.log(`📝 [WS:${roomId}] Transcribed:`, text);

        // Broadcast to all in room, tagging sender vs. others
        for (const client of rooms.get(roomId)) {
          if (client.readyState !== ws.OPEN) continue;
          const speaker = client === ws ? 'you' : 'them';
          client.send(JSON.stringify({ speaker, original: text }));
        }
      } catch (err) {
        console.error('❌ [WS] Error:', err);
      }
    });

    ws.on('close', () => {
      rooms.get(roomId).delete(ws);
      console.log(`👋 [WS] Left room=${roomId}`);
    });

    ws.on('error', err => console.error('⚠️ [WS] Socket error:', err));
  });
}
